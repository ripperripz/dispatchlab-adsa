// Food-delivery simulation: scenario generation, a discrete-event simulator
// driven by a priority queue of events, and two dispatch policies.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "graph.hpp"

using Time = std::int64_t;  // simulated milliseconds since the start

// ------------------------------------------------------------------ scenario

struct ScenarioParams {
    std::uint32_t couriers = 40;
    std::uint32_t orders = 300;
    std::uint32_t window_min = 180;   // orders arrive uniformly over this many minutes
    std::uint32_t prep_min_min = 8;   // food preparation time range, minutes
    std::uint32_t prep_max_min = 20;
    std::uint32_t drain_min = 120;    // extra time after the last order to finish deliveries
    double max_delivery_km = 6.0;     // customers live within this distance of the restaurant
    std::uint64_t seed = 42;
};

struct Order {
    std::uint32_t id;
    std::uint32_t restaurant;  // index into Scenario::restaurants
    NodeId customer;           // node where the food goes
    Time created;
    Time prep_ms;
};

// Everything random about a run, generated once from the seed. Both policies
// can be run on the same Scenario for a fair comparison.
struct Scenario {
    ScenarioParams params;
    std::vector<NodeId> restaurants;
    std::vector<NodeId> courier_starts;
    std::vector<Order> orders;  // sorted by creation time
    Time end_time = 0;
};

Scenario generate_scenario(const Graph& g, const ScenarioParams& p);

// ------------------------------------------------------------------ events

// The order of this enum is the tie-break when two events have the same time:
// finished deliveries free couriers before new orders are handed out.
enum class EventType : std::uint8_t {
    OrderDelivered,
    CourierAvailable,
    FoodReady,
    CourierArrivedRestaurant,
    OrderPickedUp,
    OrderCreated,
    CourierAssigned,
};
const char* event_name(EventType t);

// One line of the event log (also what the console replays).
struct LogEvent {
    std::uint64_t seq = 0;
    Time time = 0;
    EventType type = EventType::OrderCreated;
    int order = -1;
    int courier = -1;
    NodeId location = kNoNode;
    // Travel events only (COURIER_ASSIGNED and ORDER_PICKED_UP):
    Time travel_ms = 0;
    double distance_m = 0;
    std::vector<NodeId> path;
};

// ------------------------------------------------------------------ simulation

enum class Policy { Nearest, GreedyEta };
Policy parse_policy(const std::string& name);
const char* policy_name(Policy p);

struct Metrics {
    std::uint32_t orders_total = 0, delivered = 0, undelivered = 0;
    double avg_delivery_min = 0, p95_delivery_min = 0;
    double avg_wait_for_courier_min = 0;  // order created -> courier assigned
    double courier_utilization = 0;       // busy time / (couriers * end time)
    double total_distance_km = 0;
    std::uint64_t decisions = 0;
    double decision_mean_us = 0;          // wall-clock time per dispatch decision
    std::uint64_t events = 0;
    std::vector<double> delivery_min;     // per delivered order
    std::vector<double> delivered_at_min; // sorted delivery times
};

struct SimResult {
    Metrics metrics;
    std::vector<LogEvent> log;
    double wall_ms = 0;
};

// Runs the whole simulation. Deterministic: the same scenario and policy
// always give the same log.
SimResult simulate(const Graph& g, const Scenario& sc, Policy policy, bool keep_paths);
