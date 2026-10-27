// Tests for the heap, Dijkstra, the simulation and the API.
// Run with ./test.sh (no test framework needed).
#include <algorithm>
#include <cstdio>
#include <random>
#include <string>

#include "../src/graph.hpp"
#include "../src/server.hpp"
#include "../src/simulation.hpp"

static int failures = 0, checks = 0;
#define CHECK(cond)                                                              \
    do {                                                                         \
        ++checks;                                                                \
        if (!(cond)) {                                                           \
            ++failures;                                                          \
            std::printf("  FAILED %s:%d: %s\n", __FILE__, __LINE__, #cond);      \
        }                                                                        \
    } while (0)

// A random directed graph on a small grid of coordinates.
static Graph random_graph(std::uint32_t n, std::uint32_t m, std::uint64_t seed) {
    std::mt19937_64 rng(seed);
    std::vector<double> lat(n), lon(n);
    for (std::uint32_t i = 0; i < n; ++i) {
        lat[i] = 30.7 + (rng() % 1000) / 100000.0;
        lon[i] = 76.7 + (rng() % 1000) / 100000.0;
    }
    std::vector<Edge> edges;
    for (std::uint32_t i = 0; i < m; ++i) {
        const auto u = static_cast<NodeId>(rng() % n), v = static_cast<NodeId>(rng() % n);
        if (u != v) edges.push_back({u, v, static_cast<std::uint32_t>(1 + rng() % 1000), 10.0f, 0});
    }
    return build_graph(lat, lon, edges);
}

// A strongly connected grid with two-way roads (for the simulation tests).
static Graph grid_graph(std::uint32_t side) {
    std::vector<double> lat, lon;
    for (std::uint32_t r = 0; r < side; ++r)
        for (std::uint32_t c = 0; c < side; ++c) {
            lat.push_back(30.70 + r * 0.002);
            lon.push_back(76.70 + c * 0.002);
        }
    std::vector<Edge> edges;
    auto road = [&](NodeId a, NodeId b) {
        edges.push_back({a, b, 15000, 200.0f, 0});
        edges.push_back({b, a, 15000, 200.0f, 0});
    };
    for (std::uint32_t r = 0; r < side; ++r)
        for (std::uint32_t c = 0; c < side; ++c) {
            const NodeId v = r * side + c;
            if (c + 1 < side) road(v, v + 1);
            if (r + 1 < side) road(v, v + side);
        }
    Graph g = build_graph(lat, lon, edges);
    g.max_speed_kmh = 50;
    return g;
}

static void test_heap() {
    std::puts("heap: pops in sorted order, including duplicates");
    std::mt19937_64 rng(1);
    MinHeap heap;
    std::vector<MinHeap::Item> items;
    for (int i = 0; i < 5000; ++i) {
        const MinHeap::Item it{rng() % 300, static_cast<NodeId>(rng() % 50)};
        heap.push(it.key, it.node);
        items.push_back(it);
    }
    std::sort(items.begin(), items.end());
    bool sorted = true;
    for (const auto& want : items) {
        const MinHeap::Item got = heap.pop();
        if (got.key != want.key || got.node != want.node) sorted = false;
    }
    CHECK(sorted);
    CHECK(heap.empty());
}

static void test_dijkstra_vs_floyd_warshall() {
    std::puts("dijkstra: equals Floyd-Warshall on random graphs, paths add up");
    for (std::uint64_t seed = 1; seed <= 20; ++seed) {
        const std::uint32_t n = 30;
        const Graph g = random_graph(n, 90, seed);
        // Floyd-Warshall: O(n^3) brute force, obviously correct.
        std::vector<std::vector<Dist>> d(n, std::vector<Dist>(n, kInf));
        for (NodeId u = 0; u < n; ++u) {
            d[u][u] = 0;
            for (std::uint32_t e = g.offsets[u]; e < g.offsets[u + 1]; ++e) d[u][g.targets[e]] = std::min<Dist>(d[u][g.targets[e]], g.weights[e]);
        }
        for (NodeId k = 0; k < n; ++k)
            for (NodeId i = 0; i < n; ++i)
                for (NodeId j = 0; j < n; ++j)
                    if (d[i][k] != kInf && d[k][j] != kInf) d[i][j] = std::min(d[i][j], d[i][k] + d[k][j]);
        bool all_equal = true, paths_ok = true;
        for (NodeId s = 0; s < n; ++s)
            for (NodeId t = 0; t < n; ++t) {
                const RouteResult r = dijkstra(g, s, t);
                if (r.cost != d[s][t]) all_equal = false;
                if (r.reachable() && (path_cost(g, r.path) != r.cost || r.path.front() != s || r.path.back() != t)) paths_ok = false;
            }
        CHECK(all_equal);
        CHECK(paths_ok);
    }
}

static void test_reverse_search() {
    std::puts("dijkstra_to_target: equals one forward query per source");
    const Graph g = random_graph(200, 800, 7);
    std::vector<NodeId> sources = {0, 5, 17, 42, 99, 150, 199, 5};
    for (NodeId target : {3u, 77u, 120u}) {
        const std::vector<Dist> got = dijkstra_to_target(g, target, sources);
        bool ok = true;
        for (std::size_t i = 0; i < sources.size(); ++i) ok = ok && got[i] == dijkstra(g, sources[i], target).cost;
        CHECK(ok);
    }
}

static void test_simulation() {
    std::puts("simulation: every order delivered, events in a legal order, deterministic");
    const Graph g = grid_graph(12);
    ScenarioParams p;
    p.couriers = 4;
    p.orders = 40;
    p.window_min = 120;
    p.drain_min = 600;
    p.seed = 3;
    const Scenario sc = generate_scenario(g, p);
    for (Policy policy : {Policy::Nearest, Policy::GreedyEta}) {
        const SimResult a = simulate(g, sc, policy, true);
        CHECK(a.metrics.delivered == p.orders);
        // Times never go backwards, and each order goes created -> assigned -> picked up -> delivered.
        bool time_ok = true, order_ok = true;
        std::vector<int> stage(p.orders, 0);
        std::vector<Time> ready(p.orders, -1);
        for (std::size_t i = 0; i < a.log.size(); ++i) {
            const LogEvent& e = a.log[i];
            if (i && e.time < a.log[i - 1].time) time_ok = false;
            if (e.type == EventType::FoodReady) ready[e.order] = e.time;
            const int want = e.type == EventType::OrderCreated ? 0 : e.type == EventType::CourierAssigned ? 1
                           : e.type == EventType::OrderPickedUp ? 2 : e.type == EventType::OrderDelivered ? 3 : -1;
            if (want < 0) continue;
            if (stage[e.order] != want) order_ok = false;
            if (e.type == EventType::OrderPickedUp && (ready[e.order] < 0 || e.time < ready[e.order])) order_ok = false;
            stage[e.order] = want + 1;
        }
        CHECK(time_ok);
        CHECK(order_ok);
        // Same scenario and policy => identical log.
        const SimResult b = simulate(g, sc, policy, true);
        bool same = a.log.size() == b.log.size();
        for (std::size_t i = 0; same && i < a.log.size(); ++i) {
            same = a.log[i].time == b.log[i].time && a.log[i].type == b.log[i].type && a.log[i].courier == b.log[i].courier;
        }
        CHECK(same);
    }
}

static void test_api() {
    std::puts("api: route, bad input and path safety");
    const Graph g = grid_graph(5);
    Response r = handle_request(g, "web", parse_target("/api/route?s=0&t=24&trace=0"));
    CHECK(r.status == 200);
    CHECK(r.body.find("\"cost_ms\":120000") != std::string::npos);  // 8 segments of 15 s
    CHECK(handle_request(g, "web", parse_target("/api/route?s=-1&t=3")).status == 400);
    CHECK(handle_request(g, "web", parse_target("/api/route?s=abc&t=3")).status == 400);
    CHECK(handle_request(g, "web", parse_target("/../src/main.cpp")).status == 400);
    CHECK(handle_request(g, "web", parse_target("/api/nope")).status == 404);
    const Request q = parse_target("/api/x?a=1%202&b=");
    CHECK(q.path == "/api/x" && q.query.at("a") == "1 2" && q.query.at("b").empty());
}

int main() {
    test_heap();
    test_dijkstra_vs_floyd_warshall();
    test_reverse_search();
    test_simulation();
    test_api();
    std::printf("\n%d checks, %d failed\n", checks, failures);
    return failures ? 1 : 0;
}
