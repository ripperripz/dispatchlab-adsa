#include "simulation.hpp"

#include <algorithm>
#include <chrono>
#include <deque>
#include <queue>
#include <random>
#include <stdexcept>

// ------------------------------------------------------------------ scenario

Scenario generate_scenario(const Graph& g, const ScenarioParams& p) {
    if (g.num_nodes() < 2) throw std::invalid_argument("graph too small");
    if (p.couriers == 0) throw std::invalid_argument("need at least one courier");
    if (p.window_min == 0) throw std::invalid_argument("order window must be positive");
    if (p.prep_min_min > p.prep_max_min) throw std::invalid_argument("prep_min must not exceed prep_max");

    // std::mt19937_64 produces the same numbers on every compiler. We only use
    // its raw output (not std::uniform_*_distribution, whose results differ
    // between standard libraries), so a seed always gives the same scenario.
    std::mt19937_64 rng(p.seed);
    auto below = [&](std::uint64_t n) { return rng() % n; };
    const std::uint32_t n = g.num_nodes();

    Scenario sc;
    sc.params = p;
    sc.end_time = static_cast<Time>(p.window_min + p.drain_min) * 60000;
    const std::uint32_t num_restaurants = std::clamp<std::uint32_t>(p.orders / 10, 5, 200);
    for (std::uint32_t i = 0; i < num_restaurants; ++i) sc.restaurants.push_back(static_cast<NodeId>(below(n)));
    for (std::uint32_t i = 0; i < p.couriers; ++i) sc.courier_starts.push_back(static_cast<NodeId>(below(n)));

    const Time window_ms = static_cast<Time>(p.window_min) * 60000;
    const double max_m = p.max_delivery_km * 1000.0;
    std::vector<std::pair<Order, std::uint32_t>> drafts;  // order + draw index (stable tie-break)
    for (std::uint32_t i = 0; i < p.orders; ++i) {
        Order o{};
        o.created = static_cast<Time>(below(static_cast<std::uint64_t>(window_ms)));
        o.restaurant = static_cast<std::uint32_t>(below(num_restaurants));
        o.prep_ms = (p.prep_min_min + static_cast<Time>(below(p.prep_max_min - p.prep_min_min + 1))) * 60000;
        // Customer: a random node near the restaurant (try up to 2000 times,
        // keeping the closest candidate as a fallback).
        const NodeId r = sc.restaurants[o.restaurant];
        NodeId best = static_cast<NodeId>(below(n));
        double best_m = distance_m(g, r, best);
        for (int tries = 0; tries < 2000 && !(best_m <= max_m && best != r); ++tries) {
            const NodeId c = static_cast<NodeId>(below(n));
            const double m = distance_m(g, r, c);
            if ((m <= max_m && c != r) || m < best_m) {
                best = c;
                best_m = m;
            }
        }
        o.customer = best;
        drafts.push_back({o, i});
    }
    std::sort(drafts.begin(), drafts.end(), [](const auto& a, const auto& b) {
        return a.first.created != b.first.created ? a.first.created < b.first.created : a.second < b.second;
    });
    for (std::uint32_t i = 0; i < drafts.size(); ++i) {
        drafts[i].first.id = i;  // ids follow arrival order
        sc.orders.push_back(drafts[i].first);
    }
    return sc;
}

// ------------------------------------------------------------------ names

const char* event_name(EventType t) {
    switch (t) {
        case EventType::OrderDelivered: return "ORDER_DELIVERED";
        case EventType::CourierAvailable: return "COURIER_AVAILABLE";
        case EventType::FoodReady: return "FOOD_READY";
        case EventType::CourierArrivedRestaurant: return "COURIER_ARRIVED_RESTAURANT";
        case EventType::OrderPickedUp: return "ORDER_PICKED_UP";
        case EventType::OrderCreated: return "ORDER_CREATED";
        case EventType::CourierAssigned: return "COURIER_ASSIGNED";
    }
    return "?";
}

Policy parse_policy(const std::string& name) {
    if (name == "nearest") return Policy::Nearest;
    if (name == "greedy_eta") return Policy::GreedyEta;
    throw std::invalid_argument("unknown policy '" + name + "' (use nearest or greedy_eta)");
}

const char* policy_name(Policy p) { return p == Policy::Nearest ? "nearest" : "greedy_eta"; }

// ------------------------------------------------------------------ simulator

namespace {

// An event waiting in the queue. Ordered by time, then by type (see the enum),
// then by the order it was scheduled, so the run is fully deterministic.
struct QueuedEvent {
    Time time;
    EventType type;
    std::uint64_t id;
    int order, courier;
};
struct Later {  // std::priority_queue is a max-heap, so "less" means "comes later"
    bool operator()(const QueuedEvent& a, const QueuedEvent& b) const {
        if (a.time != b.time) return a.time > b.time;
        if (a.type != b.type) return a.type > b.type;
        return a.id > b.id;
    }
};

enum class CourierStatus { Idle, ToRestaurant, AtRestaurant, ToCustomer };

struct CourierState {
    NodeId location;
    CourierStatus status = CourierStatus::Idle;
    bool reserved = false;  // chosen, but COURIER_ASSIGNED not processed yet
    Time busy_since = 0, busy_ms = 0;
    double distance_m = 0;
};

struct OrderState {
    int courier = -1;
    bool food_ready = false, courier_arrived = false, picked_up = false;
    Time assigned_at = -1, delivered_at = -1;
};

class Simulator {
public:
    Simulator(const Graph& g, const Scenario& sc, Policy policy, bool keep_paths)
        : g_(g), sc_(sc), policy_(policy), keep_paths_(keep_paths), orders_(sc.orders.size()) {
        for (NodeId start : sc.courier_starts) couriers_.push_back({start});
    }

    SimResult run() {
        const auto t0 = std::chrono::steady_clock::now();
        for (const Order& o : sc_.orders) schedule(o.created, EventType::OrderCreated, static_cast<int>(o.id), -1);
        while (!queue_.empty() && queue_.top().time <= sc_.end_time) {
            const QueuedEvent ev = queue_.top();
            queue_.pop();
            handle(ev);
        }
        SimResult res;
        res.log = std::move(log_);
        res.metrics = metrics(res.log.size());
        res.wall_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
        return res;
    }

private:
    void schedule(Time t, EventType type, int order, int courier) { queue_.push({t, type, next_id_++, order, courier}); }

    LogEvent& emit(const QueuedEvent& ev, NodeId location) {
        LogEvent e;
        e.seq = log_.size();
        e.time = ev.time;
        e.type = ev.type;
        e.order = ev.order;
        e.courier = ev.courier;
        e.location = location;
        log_.push_back(std::move(e));
        return log_.back();
    }

    NodeId restaurant_of(int order) const { return sc_.restaurants[sc_.orders[order].restaurant]; }

    // Travel from `from` to `to`: Dijkstra gives the time; the log keeps the path for drawing.
    Time travel(LogEvent& e, int courier, NodeId from, NodeId to) {
        RouteResult r = dijkstra(g_, from, to);
        if (!r.reachable()) throw std::runtime_error("destination unreachable");
        e.travel_ms = static_cast<Time>(r.cost);
        e.distance_m = path_length_m(g_, r.path);
        couriers_[courier].distance_m += e.distance_m;
        if (keep_paths_) e.path = std::move(r.path);
        return e.travel_ms;
    }

    void handle(const QueuedEvent& ev) {
        const int o = ev.order, c = ev.courier;
        switch (ev.type) {
            case EventType::OrderCreated: {
                emit(ev, restaurant_of(o));
                schedule(ev.time + sc_.orders[o].prep_ms, EventType::FoodReady, o, -1);
                pending_.push_back(o);
                dispatch(ev.time);
                break;
            }
            case EventType::FoodReady: {
                emit(ev, restaurant_of(o));
                orders_[o].food_ready = true;
                // The courier was already waiting: pick up now.
                if (orders_[o].courier_arrived) schedule(ev.time, EventType::OrderPickedUp, o, orders_[o].courier);
                break;
            }
            case EventType::CourierAssigned: {
                CourierState& cs = couriers_[c];
                LogEvent& e = emit(ev, cs.location);
                const Time t = travel(e, c, cs.location, restaurant_of(o));
                cs.reserved = false;
                cs.status = CourierStatus::ToRestaurant;
                cs.busy_since = ev.time;
                orders_[o].courier = c;
                orders_[o].assigned_at = ev.time;
                schedule(ev.time + t, EventType::CourierArrivedRestaurant, o, c);
                break;
            }
            case EventType::CourierArrivedRestaurant: {
                CourierState& cs = couriers_[c];
                cs.location = restaurant_of(o);
                cs.status = CourierStatus::AtRestaurant;
                emit(ev, cs.location);
                orders_[o].courier_arrived = true;
                // The food was already ready: pick up now. Otherwise FOOD_READY will.
                if (orders_[o].food_ready) schedule(ev.time, EventType::OrderPickedUp, o, c);
                break;
            }
            case EventType::OrderPickedUp: {
                CourierState& cs = couriers_[c];
                LogEvent& e = emit(ev, cs.location);
                const Time t = travel(e, c, cs.location, sc_.orders[o].customer);
                cs.status = CourierStatus::ToCustomer;
                orders_[o].picked_up = true;
                schedule(ev.time + t, EventType::OrderDelivered, o, c);
                break;
            }
            case EventType::OrderDelivered: {
                CourierState& cs = couriers_[c];
                cs.location = sc_.orders[o].customer;
                emit(ev, cs.location);
                orders_[o].delivered_at = ev.time;
                schedule(ev.time, EventType::CourierAvailable, -1, c);
                break;
            }
            case EventType::CourierAvailable: {
                CourierState& cs = couriers_[c];
                emit(ev, cs.location);
                cs.status = CourierStatus::Idle;
                cs.busy_ms += ev.time - cs.busy_since;
                dispatch(ev.time);
                break;
            }
        }
    }

    // Gives waiting orders (oldest first) to free couriers, as long as both exist.
    void dispatch(Time now) {
        while (!pending_.empty()) {
            std::vector<int> available;
            for (int c = 0; c < static_cast<int>(couriers_.size()); ++c) {
                if (couriers_[c].status == CourierStatus::Idle && !couriers_[c].reserved) available.push_back(c);
            }
            if (available.empty()) return;  // the order waits for the next free courier
            const int o = pending_.front();
            pending_.pop_front();
            const auto t0 = std::chrono::steady_clock::now();
            const int c = choose(o, now, available);
            decision_us_ += std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - t0).count();
            ++decisions_;
            couriers_[c].reserved = true;
            schedule(now, EventType::CourierAssigned, o, c);
        }
    }

    int choose(int o, Time now, const std::vector<int>& available) const {
        const NodeId r = restaurant_of(o);
        if (policy_ == Policy::Nearest) {
            // Closest courier in a straight line; ties go to the lowest id.
            int best = available[0];
            double best_m = distance_m(g_, couriers_[best].location, r);
            for (int c : available) {
                const double m = distance_m(g_, couriers_[c].location, r);
                if (m < best_m) {
                    best = c;
                    best_m = m;
                }
            }
            return best;
        }
        // Greedy ETA: earliest delivery time
        //   ETA(c) = max(now + T(c, r), food ready) + T(r, customer)
        // One backward Dijkstra from the restaurant gives T(c, r) for every courier.
        std::vector<NodeId> locations;
        for (int c : available) locations.push_back(couriers_[c].location);
        const std::vector<Dist> to_r = dijkstra_to_target(g_, r, locations);
        const Dist r_to_customer = dijkstra(g_, r, sc_.orders[o].customer).cost;  // same for every courier
        const Time ready = sc_.orders[o].created + sc_.orders[o].prep_ms;
        int best = -1;
        Time best_eta = 0;
        Dist best_t = 0;
        for (std::size_t i = 0; i < available.size(); ++i) {
            if (to_r[i] == kInf) continue;
            const Time eta = std::max(now + static_cast<Time>(to_r[i]), ready) + static_cast<Time>(r_to_customer);
            // Ties: shorter trip to the restaurant, then lower id (available is in id order).
            if (best < 0 || eta < best_eta || (eta == best_eta && to_r[i] < best_t)) {
                best = available[i];
                best_eta = eta;
                best_t = to_r[i];
            }
        }
        if (best < 0) throw std::runtime_error("no courier can reach the restaurant");
        return best;
    }

    Metrics metrics(std::size_t events) const {
        Metrics m;
        m.orders_total = static_cast<std::uint32_t>(sc_.orders.size());
        m.events = events;
        double wait_sum = 0;
        std::uint32_t assigned = 0;
        for (std::size_t i = 0; i < orders_.size(); ++i) {
            const OrderState& os = orders_[i];
            if (os.assigned_at >= 0) {
                wait_sum += static_cast<double>(os.assigned_at - sc_.orders[i].created) / 60000.0;
                ++assigned;
            }
            if (os.delivered_at >= 0) {
                m.delivery_min.push_back(static_cast<double>(os.delivered_at - sc_.orders[i].created) / 60000.0);
                m.delivered_at_min.push_back(static_cast<double>(os.delivered_at) / 60000.0);
            }
        }
        m.delivered = static_cast<std::uint32_t>(m.delivery_min.size());
        m.undelivered = m.orders_total - m.delivered;
        if (m.delivered) {
            double sum = 0;
            for (double x : m.delivery_min) sum += x;
            m.avg_delivery_min = sum / m.delivered;
            std::vector<double> sorted = m.delivery_min;
            std::sort(sorted.begin(), sorted.end());
            m.p95_delivery_min = sorted[std::min(sorted.size() - 1, static_cast<std::size_t>(0.95 * sorted.size()))];
        }
        std::sort(m.delivered_at_min.begin(), m.delivered_at_min.end());
        m.avg_wait_for_courier_min = assigned ? wait_sum / assigned : 0;
        double busy = 0;
        for (const CourierState& cs : couriers_) {
            busy += static_cast<double>(cs.busy_ms);
            if (cs.status != CourierStatus::Idle) busy += static_cast<double>(sc_.end_time - cs.busy_since);  // still out at the end
            m.total_distance_km += cs.distance_m / 1000.0;
        }
        m.courier_utilization = busy / (static_cast<double>(couriers_.size()) * static_cast<double>(sc_.end_time));
        m.decisions = decisions_;
        m.decision_mean_us = decisions_ ? decision_us_ / static_cast<double>(decisions_) : 0;
        return m;
    }

    const Graph& g_;
    const Scenario& sc_;
    Policy policy_;
    bool keep_paths_;
    std::priority_queue<QueuedEvent, std::vector<QueuedEvent>, Later> queue_;
    std::uint64_t next_id_ = 0;
    std::vector<CourierState> couriers_;
    std::vector<OrderState> orders_;
    std::deque<int> pending_;  // orders waiting for a courier, oldest first
    std::vector<LogEvent> log_;
    std::uint64_t decisions_ = 0;
    double decision_us_ = 0;
};

}  // namespace

SimResult simulate(const Graph& g, const Scenario& sc, Policy policy, bool keep_paths) {
    return Simulator(g, sc, policy, keep_paths).run();
}
