// DispatchLab ADSA: command-line entry point.
//
//   dispatchlab serve    [--graph FILE] [--port 8080] [--web web]
//   dispatchlab route    <from> <to> [--graph FILE]
//   dispatchlab simulate [--policy nearest|greedy_eta] [--couriers 40] [--orders 300] [--seed 42] [--graph FILE]
#include <chrono>
#include <cstdio>
#include <map>
#include <string>

#include "graph.hpp"
#include "server.hpp"
#include "simulation.hpp"

namespace {

// "--name value" pairs plus positional arguments.
struct Args {
    std::vector<std::string> positional;
    std::map<std::string, std::string> options;
    Args(int argc, char** argv) {
        for (int i = 2; i < argc; ++i) {
            const std::string a = argv[i];
            if (a.rfind("--", 0) == 0 && i + 1 < argc) options[a.substr(2)] = argv[++i];
            else positional.push_back(a);
        }
    }
    std::string get(const std::string& name, const std::string& def) const {
        auto it = options.find(name);
        return it == options.end() ? def : it->second;
    }
    long long num(const std::string& name, long long def) const { return std::stoll(get(name, std::to_string(def))); }
};

Graph load(const Args& a) {
    const auto t0 = std::chrono::steady_clock::now();
    Graph g = load_graph(a.get("graph", "data/tricity.graph.txt"));
    const double s = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    std::printf("graph: %u nodes, %u directed edges (loaded in %.2f s)\n", g.num_nodes(), g.num_edges(), s);
    return g;
}

void usage() {
    std::printf(
        "DispatchLab ADSA - Dijkstra routing and food-delivery dispatch on the Tricity road network\n\n"
        "usage:\n"
        "  dispatchlab serve    [--graph FILE] [--port 8080] [--web web]\n"
        "  dispatchlab route    <from> <to> [--graph FILE]\n"
        "  dispatchlab simulate [--policy nearest|greedy_eta] [--couriers 40] [--orders 300] [--seed 42]\n");
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        usage();
        return 1;
    }
    const std::string cmd = argv[1];
    const Args a(argc, argv);
    try {
        if (cmd == "serve") {
            const Graph g = load(a);
            serve(g, a.get("web", "web"), static_cast<int>(a.num("port", 8080)));
        } else if (cmd == "route") {
            if (a.positional.size() != 2) throw std::invalid_argument("route needs <from> <to>");
            const Graph g = load(a);
            const auto s = static_cast<NodeId>(std::stoul(a.positional[0]));
            const auto t = static_cast<NodeId>(std::stoul(a.positional[1]));
            const auto t0 = std::chrono::steady_clock::now();
            const RouteResult r = dijkstra(g, s, t);
            const double us = std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - t0).count();
            if (!r.reachable()) {
                std::printf("no route from %u to %u\n", s, t);
                return 0;
            }
            std::printf("travel time %.1f min, %.2f km, %zu nodes on the path\n", r.cost / 60000.0,
                        path_length_m(g, r.path) / 1000.0, r.path.size());
            std::printf("Dijkstra settled %u nodes and relaxed %u edges in %.0f us\n", r.settled_count, r.relaxed_count, us);
        } else if (cmd == "simulate") {
            const Graph g = load(a);
            ScenarioParams p;
            p.couriers = static_cast<std::uint32_t>(a.num("couriers", 40));
            p.orders = static_cast<std::uint32_t>(a.num("orders", 300));
            p.seed = static_cast<std::uint64_t>(a.num("seed", 42));
            const Policy policy = parse_policy(a.get("policy", "greedy_eta"));
            const SimResult r = simulate(g, generate_scenario(g, p), policy, false);
            const Metrics& m = r.metrics;
            std::printf("policy %s: %u/%u orders delivered, average %.2f min, p95 %.2f min\n", policy_name(policy),
                        m.delivered, m.orders_total, m.avg_delivery_min, m.p95_delivery_min);
            std::printf("courier utilization %.1f%%, %.1f km driven, %llu events, %.0f ms\n", m.courier_utilization * 100,
                        m.total_distance_km, static_cast<unsigned long long>(m.events), r.wall_ms);
        } else {
            usage();
            return 1;
        }
    } catch (const std::exception& e) {
        std::fprintf(stderr, "error: %s\n", e.what());
        return 1;
    }
    return 0;
}
