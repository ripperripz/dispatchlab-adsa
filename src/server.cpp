#include "server.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <type_traits>

#include "simulation.hpp"

namespace {

// ------------------------------------------------------------------ JSON output

// Minimal JSON writer: call the methods in the order the JSON should appear.
class Json {
public:
    Json& begin_object() { sep(); out_ += '{'; first_ = true; return *this; }
    Json& end_object() { out_ += '}'; first_ = false; return *this; }
    Json& begin_array() { sep(); out_ += '['; first_ = true; return *this; }
    Json& end_array() { out_ += ']'; first_ = false; return *this; }
    Json& key(const std::string& k) { sep(); out_ += '"' + k + "\":"; first_ = true; return *this; }
    Json& value(const std::string& s) { sep(); out_ += '"' + escape(s) + '"'; return *this; }
    Json& value(const char* s) { return value(std::string(s)); }
    Json& value(bool b) { sep(); out_ += b ? "true" : "false"; return *this; }
    Json& value(double d, int decimals = 3) {
        sep();
        if (!std::isfinite(d)) { out_ += "null"; return *this; }
        char buf[64];
        std::snprintf(buf, sizeof buf, "%.*f", decimals, d);
        out_ += buf;
        return *this;
    }
    template <class Int, class = std::enable_if_t<std::is_integral_v<Int>>>
    Json& value(Int i) { sep(); out_ += std::to_string(i); return *this; }
    template <class T>
    Json& kv(const std::string& k, T v) { key(k); return value(v); }
    Json& kv(const std::string& k, double v, int decimals) { key(k); return value(v, decimals); }
    Json& raw(const std::string& json) { sep(); out_ += json; return *this; }
    std::string str() const { return out_; }

private:
    void sep() {
        if (!first_ && !out_.empty() && out_.back() != '[' && out_.back() != '{' && out_.back() != ':') out_ += ',';
        first_ = false;
    }
    static std::string escape(const std::string& s) {
        std::string r;
        for (char c : s) {
            if (c == '"' || c == '\\') { r += '\\'; r += c; }
            else if (static_cast<unsigned char>(c) < 0x20) r += ' ';
            else r += c;
        }
        return r;
    }
    std::string out_;
    bool first_ = true;
};

// ------------------------------------------------------------------ request helpers

long long int_param(const Request& req, const std::string& name, long long def, long long lo, long long hi) {
    auto it = req.query.find(name);
    if (it == req.query.end() || it->second.empty()) return def;
    char* end = nullptr;
    const long long v = std::strtoll(it->second.c_str(), &end, 10);
    if (*end != '\0') throw std::invalid_argument("parameter '" + name + "' must be a whole number");
    if (v < lo || v > hi) {
        throw std::invalid_argument("parameter '" + name + "' must be between " + std::to_string(lo) + " and " +
                                    std::to_string(hi));
    }
    return v;
}

std::string text_param(const Request& req, const std::string& name, const std::string& def) {
    auto it = req.query.find(name);
    return it == req.query.end() || it->second.empty() ? def : it->second;
}

ScenarioParams scenario_params(const Request& req) {
    ScenarioParams p;
    p.couriers = static_cast<std::uint32_t>(int_param(req, "couriers", 40, 1, 500));
    p.orders = static_cast<std::uint32_t>(int_param(req, "orders", 300, 1, 3000));
    p.window_min = static_cast<std::uint32_t>(int_param(req, "window", 180, 10, 1440));
    p.seed = static_cast<std::uint64_t>(int_param(req, "seed", 42, 0, 2147483647));
    return p;
}

void write_metrics(Json& j, const Metrics& m) {
    j.begin_object();
    j.kv("orders_total", m.orders_total).kv("orders_delivered", m.delivered).kv("orders_undelivered", m.undelivered);
    j.kv("avg_delivery_min", m.avg_delivery_min, 2).kv("p95_delivery_min", m.p95_delivery_min, 2);
    j.kv("avg_wait_for_courier_min", m.avg_wait_for_courier_min, 2);
    j.kv("courier_utilization", m.courier_utilization, 4).kv("total_distance_km", m.total_distance_km, 2);
    j.kv("dispatch_decisions", m.decisions).kv("decision_mean_us", m.decision_mean_us, 1);
    j.kv("events", m.events);
    j.end_object();
}

void write_scenario(Json& j, const Scenario& sc) {
    j.begin_object();
    j.kv("couriers", sc.courier_starts.size()).kv("orders", sc.orders.size()).kv("restaurants", sc.restaurants.size());
    j.kv("seed", sc.params.seed).kv("window_min", sc.params.window_min).kv("end_time", sc.end_time);
    j.end_object();
}

// The replay document the console's Simulation page plays back
// (same "dispatchlab-replay-1" format as the full DispatchLab).
std::string replay_document(const Scenario& sc, const SimResult& r, Policy policy) {
    Json j;
    j.begin_object();
    j.kv("format", "dispatchlab-replay-1");
    j.key("meta").begin_object();
    j.kv("policy", policy_name(policy)).kv("end_time", sc.end_time).kv("seed", sc.params.seed);
    j.end_object();
    j.key("restaurants").begin_array();
    for (std::size_t i = 0; i < sc.restaurants.size(); ++i) j.begin_array().value(i).value(sc.restaurants[i]).end_array();
    j.end_array();
    j.key("customers").begin_array();
    for (const Order& o : sc.orders) j.begin_array().value(o.id).value(o.customer).end_array();
    j.end_array();
    j.key("couriers").begin_array();
    for (std::size_t i = 0; i < sc.courier_starts.size(); ++i) j.begin_array().value(i).value(sc.courier_starts[i]).end_array();
    j.end_array();
    j.key("orders").begin_array();  // [id, restaurant, customer, created, prep]
    for (const Order& o : sc.orders) {
        j.begin_array().value(o.id).value(o.restaurant).value(o.id).value(o.created).value(o.prep_ms).end_array();
    }
    j.end_array();
    j.key("events").begin_array();
    for (const LogEvent& e : r.log) {
        j.begin_object();
        j.kv("seq", e.seq).kv("timestamp", e.time).kv("event", event_name(e.type));
        j.kv("order_id", e.order).kv("courier_id", e.courier).kv("location", e.location);
        if (e.type == EventType::CourierAssigned || e.type == EventType::OrderPickedUp) {
            j.kv("travel_ms", e.travel_ms).kv("distance_mm", static_cast<long long>(std::llround(e.distance_m * 1000)));
            j.key("path").begin_array();
            for (NodeId v : e.path) j.value(v);
            j.end_array();
        }
        j.end_object();
    }
    j.end_array();
    j.end_object();
    return j.str();
}

// ------------------------------------------------------------------ endpoints

Response json(std::string body) { return {200, "application/json", std::move(body)}; }

Response error(int status, const std::string& message) {
    Json j;
    j.begin_object().kv("error", message).end_object();
    return {status, "application/json", j.str()};
}

Response api_info(const Graph& g) {
    double km = 0;
    for (float len : g.lengths_m) km += len / 1000.0;
    Json j;
    j.begin_object();
    j.kv("engine", "DispatchLab ADSA");
    j.key("graph").begin_object();
    j.kv("nodes", g.num_nodes()).kv("edges", g.num_edges()).kv("max_speed_kmh", g.max_speed_kmh);
    j.kv("total_length_km", km, 1);
    j.end_object();
    j.end_object();
    return json(j.str());
}

// Nodes and road segments for drawing the map (each two-way road drawn once).
std::string network_json(const Graph& g) {
    double min_lon = 1e9, min_lat = 1e9, max_lon = -1e9, max_lat = -1e9;
    for (NodeId v = 0; v < g.num_nodes(); ++v) {
        min_lon = std::min(min_lon, g.lon[v]);
        max_lon = std::max(max_lon, g.lon[v]);
        min_lat = std::min(min_lat, g.lat[v]);
        max_lat = std::max(max_lat, g.lat[v]);
    }
    auto has_edge = [&](NodeId a, NodeId b) {
        for (std::uint32_t e = g.offsets[a]; e < g.offsets[a + 1]; ++e) if (g.targets[e] == b) return true;
        return false;
    };
    Json j;
    j.begin_object();
    j.key("bbox").begin_array().value(min_lon, 6).value(min_lat, 6).value(max_lon, 6).value(max_lat, 6).end_array();
    j.key("nodes").begin_array();
    for (NodeId v = 0; v < g.num_nodes(); ++v) j.value(g.lon[v], 5).value(g.lat[v], 5);
    j.end_array();
    std::vector<int> arterial;
    j.key("edges").begin_array();
    for (NodeId u = 0; u < g.num_nodes(); ++u) {
        for (std::uint32_t e = g.offsets[u]; e < g.offsets[u + 1]; ++e) {
            const NodeId v = g.targets[e];
            if (u < v || !has_edge(v, u)) {
                j.value(u).value(v);
                arterial.push_back(g.arterial[e]);
            }
        }
    }
    j.end_array();
    j.key("edge_arterial").begin_array();
    for (int a : arterial) j.value(a);
    j.end_array();
    j.end_object();
    return j.str();
}

Response api_route(const Graph& g, const Request& req) {
    const long long n = g.num_nodes();
    const auto s = static_cast<NodeId>(int_param(req, "s", 0, 0, n - 1));
    const auto t = static_cast<NodeId>(int_param(req, "t", 0, 0, n - 1));
    const bool trace = text_param(req, "trace", "1") != "0";
    const auto t0 = std::chrono::steady_clock::now();
    const RouteResult r = dijkstra(g, s, t, trace);
    const double us = std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - t0).count();
    Json j;
    j.begin_object();
    j.kv("s", s).kv("t", t).kv("reachable", r.reachable());
    j.kv("cost_ms", r.reachable() ? static_cast<long long>(r.cost) : -1LL);
    j.kv("length_m", path_length_m(g, r.path), 1);
    j.kv("path_cost_ok", !r.reachable() || path_cost(g, r.path) == r.cost);
    j.kv("settled", r.settled_count).kv("relaxed", r.relaxed_count).kv("latency_us", us, 1);
    j.key("path").begin_array();
    for (NodeId v : r.path) j.value(v);
    j.end_array();
    j.key("trace").begin_array();
    for (NodeId v : r.settled) j.value(v);
    j.end_array();
    j.end_object();
    return json(j.str());
}

Response api_simulate(const Graph& g, const Request& req) {
    const Scenario sc = generate_scenario(g, scenario_params(req));
    const Policy policy = parse_policy(text_param(req, "policy", "greedy_eta"));
    const SimResult r = simulate(g, sc, policy, /*keep_paths=*/true);
    Json j;
    j.begin_object();
    j.kv("policy", policy_name(policy));
    j.key("scenario");
    write_scenario(j, sc);
    j.key("metrics");
    write_metrics(j, r.metrics);
    j.kv("sim_wall_ms", r.wall_ms, 1);
    j.key("replay").raw(replay_document(sc, r, policy));
    j.end_object();
    return json(j.str());
}

// Both policies on ONE scenario, so the only difference is the policy.
Response api_compare(const Graph& g, const Request& req) {
    const Scenario sc = generate_scenario(g, scenario_params(req));
    Json j;
    j.begin_object();
    j.key("scenario");
    write_scenario(j, sc);
    j.key("runs").begin_array();
    for (Policy p : {Policy::Nearest, Policy::GreedyEta}) {
        const SimResult r = simulate(g, sc, p, /*keep_paths=*/false);
        j.begin_object();
        j.kv("policy", policy_name(p)).kv("sim_wall_ms", r.wall_ms, 1);
        j.key("metrics");
        write_metrics(j, r.metrics);
        j.key("delivery_min").begin_array();
        for (double x : r.metrics.delivery_min) j.value(x, 2);
        j.end_array();
        j.key("delivered_at_min").begin_array();
        for (double x : r.metrics.delivered_at_min) j.value(x, 2);
        j.end_array();
        j.end_object();
    }
    j.end_array();
    j.end_object();
    return json(j.str());
}

std::string content_type_for(const std::string& path) {
    auto ends = [&](const char* ext) { return path.size() >= std::strlen(ext) && path.compare(path.size() - std::strlen(ext), std::string::npos, ext) == 0; };
    if (ends(".html")) return "text/html; charset=utf-8";
    if (ends(".css")) return "text/css; charset=utf-8";
    if (ends(".js")) return "text/javascript; charset=utf-8";
    if (ends(".svg")) return "image/svg+xml";
    if (ends(".woff2")) return "font/woff2";
    return "application/octet-stream";
}

Response static_file(const std::string& web_root, const std::string& path) {
    const std::string rel = path == "/" ? "/index.html" : path;
    if (rel.find("..") != std::string::npos) return error(400, "invalid path");  // stay inside web/
    std::ifstream in(web_root + rel, std::ios::binary);
    if (!in) return error(404, "not found: " + rel);
    std::ostringstream ss;
    ss << in.rdbuf();
    return {200, content_type_for(rel), ss.str()};
}

std::string url_decode(const std::string& s) {
    std::string out;
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '+') out += ' ';
        else if (s[i] == '%' && i + 2 < s.size()) {
            out += static_cast<char>(std::stoi(s.substr(i + 1, 2), nullptr, 16));
            i += 2;
        } else out += s[i];
    }
    return out;
}

const char* reason(int status) {
    switch (status) {
        case 200: return "OK";
        case 400: return "Bad Request";
        case 404: return "Not Found";
        default: return "Internal Server Error";
    }
}

}  // namespace

Request parse_target(const std::string& target) {
    Request req;
    const std::size_t q = target.find('?');
    req.path = url_decode(target.substr(0, q));
    if (q == std::string::npos) return req;
    std::istringstream params(target.substr(q + 1));
    std::string pair;
    while (std::getline(params, pair, '&')) {
        const std::size_t eq = pair.find('=');
        if (eq == std::string::npos) req.query[url_decode(pair)] = "";
        else req.query[url_decode(pair.substr(0, eq))] = url_decode(pair.substr(eq + 1));
    }
    return req;
}

Response handle_request(const Graph& g, const std::string& web_root, const Request& req) {
    static const std::string network = network_json(g);  // built once, on first use
    try {
        if (req.path == "/api/info") return api_info(g);
        if (req.path == "/api/network") return json(network);
        if (req.path == "/api/route") return api_route(g, req);
        if (req.path == "/api/simulate") return api_simulate(g, req);
        if (req.path == "/api/compare") return api_compare(g, req);
        if (req.path.rfind("/api/", 0) == 0) return error(404, "unknown endpoint " + req.path);
        return static_file(web_root, req.path);
    } catch (const std::invalid_argument& e) {
        return error(400, e.what());
    } catch (const std::exception& e) {
        return error(500, e.what());
    }
}

void serve(const Graph& g, const std::string& web_root, int port) {
    std::signal(SIGPIPE, SIG_IGN);  // a browser closing early must not stop the server
    const int listener = ::socket(AF_INET, SOCK_STREAM, 0);
    if (listener < 0) throw std::runtime_error("socket() failed");
    int one = 1;
    ::setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<std::uint16_t>(port));
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);  // only this computer can connect
    if (::bind(listener, reinterpret_cast<sockaddr*>(&addr), sizeof addr) != 0) {
        throw std::runtime_error("cannot use port " + std::to_string(port) + " (already in use?)");
    }
    ::listen(listener, 32);
    std::printf("DispatchLab ADSA: open http://127.0.0.1:%d  (Ctrl+C to stop)\n", port);
    std::fflush(stdout);

    while (true) {
        const int client = ::accept(listener, nullptr, nullptr);
        if (client < 0) continue;
        // Read the request head: "GET /api/route?s=1&t=2 HTTP/1.1\r\n...\r\n\r\n".
        std::string head;
        char buf[4096];
        while (head.find("\r\n\r\n") == std::string::npos && head.size() < 65536) {
            const ssize_t got = ::recv(client, buf, sizeof buf, 0);
            if (got <= 0) break;
            head.append(buf, static_cast<std::size_t>(got));
        }
        Response res;
        std::istringstream line(head.substr(0, head.find("\r\n")));
        std::string method, target;
        line >> method >> target;
        if (method != "GET" || target.empty()) res = error(400, "only GET requests are supported");
        else res = handle_request(g, web_root, parse_target(target));

        std::string out = "HTTP/1.1 " + std::to_string(res.status) + " " + reason(res.status) + "\r\n";
        out += "Content-Type: " + res.content_type + "\r\n";
        out += "Content-Length: " + std::to_string(res.body.size()) + "\r\n";
        out += "Cache-Control: no-cache\r\nConnection: close\r\n\r\n";
        out += res.body;
        std::size_t sent = 0;
        while (sent < out.size()) {
            const ssize_t n = ::send(client, out.data() + sent, out.size() - sent, 0);
            if (n <= 0) break;
            sent += static_cast<std::size_t>(n);
        }
        ::close(client);
        std::printf("%s %s -> %d\n", method.c_str(), target.substr(0, target.find('?')).c_str(), res.status);
    }
}
