#include "graph.hpp"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <sstream>

// ------------------------------------------------------------------ graph

Graph build_graph(std::vector<double> lat, std::vector<double> lon, std::vector<Edge> edges) {
    const std::uint32_t n = static_cast<std::uint32_t>(lat.size());
    for (const Edge& e : edges) {
        if (e.from >= n || e.to >= n) throw std::invalid_argument("edge refers to a missing node");
        if (e.weight_ms == 0) throw std::invalid_argument("edge weights must be positive");
    }
    // Sorting by source groups each node's edges together (needed for CSR).
    std::sort(edges.begin(), edges.end(),
              [](const Edge& a, const Edge& b) { return a.from != b.from ? a.from < b.from : a.to < b.to; });

    Graph g;
    g.lat = std::move(lat);
    g.lon = std::move(lon);
    g.offsets.assign(n + 1, 0);
    for (const Edge& e : edges) {
        g.offsets[e.from + 1]++;  // count edges per node...
        g.targets.push_back(e.to);
        g.weights.push_back(e.weight_ms);
        g.lengths_m.push_back(e.length_m);
        g.arterial.push_back(e.arterial);
    }
    for (std::uint32_t i = 0; i < n; ++i) g.offsets[i + 1] += g.offsets[i];  // ...then prefix sums give start positions

    // Reverse CSR: same counting trick, grouped by target.
    g.rev_offsets.assign(n + 1, 0);
    for (const Edge& e : edges) g.rev_offsets[e.to + 1]++;
    for (std::uint32_t i = 0; i < n; ++i) g.rev_offsets[i + 1] += g.rev_offsets[i];
    g.rev_sources.resize(edges.size());
    g.rev_weights.resize(edges.size());
    std::vector<std::uint32_t> fill(g.rev_offsets.begin(), g.rev_offsets.end() - 1);
    for (const Edge& e : edges) {
        const std::uint32_t pos = fill[e.to]++;
        g.rev_sources[pos] = e.from;
        g.rev_weights[pos] = e.weight_ms;
    }
    return g;
}

Graph load_graph(const std::string& path) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("cannot open graph file " + path);
    std::string line;
    // Skip comment lines.
    while (std::getline(in, line) && (line.empty() || line[0] == '#')) {}
    std::istringstream header(line);
    std::uint32_t n = 0, m = 0, vmax = 0;
    if (!(header >> n >> m >> vmax)) throw std::runtime_error("bad graph header in " + path);

    std::vector<double> lat(n), lon(n);
    for (std::uint32_t i = 0; i < n; ++i) {
        if (!(in >> lat[i] >> lon[i])) throw std::runtime_error("graph file ends early (nodes)");
    }
    std::vector<Edge> edges(m);
    for (std::uint32_t i = 0; i < m; ++i) {
        unsigned arterial = 0;
        Edge& e = edges[i];
        if (!(in >> e.from >> e.to >> e.weight_ms >> e.length_m >> arterial)) {
            throw std::runtime_error("graph file ends early (edges)");
        }
        e.arterial = static_cast<std::uint8_t>(arterial);
    }
    Graph g = build_graph(std::move(lat), std::move(lon), std::move(edges));
    g.max_speed_kmh = vmax;
    return g;
}

double distance_m(const Graph& g, NodeId a, NodeId b) {
    constexpr double kEarthRadiusM = 6371008.8;
    constexpr double kDeg = 3.14159265358979323846 / 180.0;
    const double dlat = (g.lat[b] - g.lat[a]) * kDeg;
    const double dlon = (g.lon[b] - g.lon[a]) * kDeg;
    const double h = std::sin(dlat / 2) * std::sin(dlat / 2) +
                     std::cos(g.lat[a] * kDeg) * std::cos(g.lat[b] * kDeg) * std::sin(dlon / 2) * std::sin(dlon / 2);
    return 2 * kEarthRadiusM * std::asin(std::min(1.0, std::sqrt(h)));
}

// ------------------------------------------------------------------ heap

void MinHeap::push(Dist key, NodeId node) {
    // Add at the end, then move up while smaller than the parent.
    items_.push_back({key, node});
    std::size_t i = items_.size() - 1;
    while (i > 0) {
        const std::size_t parent = (i - 1) / 2;
        if (!(items_[i] < items_[parent])) break;
        std::swap(items_[i], items_[parent]);
        i = parent;
    }
}

MinHeap::Item MinHeap::pop() {
    if (items_.empty()) throw std::out_of_range("pop from an empty heap");
    const Item top = items_.front();
    // Move the last item to the root, then move it down while a child is smaller.
    items_.front() = items_.back();
    items_.pop_back();
    std::size_t i = 0;
    const std::size_t n = items_.size();
    while (true) {
        const std::size_t left = 2 * i + 1, right = left + 1;
        std::size_t smallest = i;
        if (left < n && items_[left] < items_[smallest]) smallest = left;
        if (right < n && items_[right] < items_[smallest]) smallest = right;
        if (smallest == i) break;
        std::swap(items_[i], items_[smallest]);
        i = smallest;
    }
    return top;
}

// ------------------------------------------------------------------ Dijkstra

RouteResult dijkstra(const Graph& g, NodeId s, NodeId t, bool keep_trace) {
    const std::uint32_t n = g.num_nodes();
    if (s >= n || t >= n) throw std::invalid_argument("node id out of range");
    std::vector<Dist> dist(n, kInf);
    std::vector<NodeId> parent(n, kNoNode);
    MinHeap heap;
    RouteResult r;

    dist[s] = 0;
    heap.push(0, s);
    while (!heap.empty()) {
        const MinHeap::Item top = heap.pop();
        const NodeId u = top.node;
        // "Lazy deletion": a node may be in the heap several times. Only the entry
        // with its current (smallest) distance counts; older ones are skipped.
        if (top.key != dist[u]) continue;
        // u is now settled: with non-negative weights, no shorter path to u exists.
        ++r.settled_count;
        if (keep_trace) r.settled.push_back(u);
        if (u == t) break;
        for (std::uint32_t e = g.offsets[u]; e < g.offsets[u + 1]; ++e) {
            const NodeId v = g.targets[e];
            const Dist nd = dist[u] + g.weights[e];
            if (nd < dist[v]) {  // relax the edge u -> v
                dist[v] = nd;
                parent[v] = u;
                heap.push(nd, v);
                ++r.relaxed_count;
            }
        }
    }
    if (dist[t] == kInf) return r;
    r.cost = dist[t];
    for (NodeId v = t; v != kNoNode; v = parent[v]) r.path.push_back(v);
    std::reverse(r.path.begin(), r.path.end());
    return r;
}

std::vector<Dist> dijkstra_to_target(const Graph& g, NodeId target, const std::vector<NodeId>& sources) {
    const std::uint32_t n = g.num_nodes();
    if (target >= n) throw std::invalid_argument("node id out of range");
    std::vector<Dist> dist(n, kInf);
    std::vector<char> wanted(n, 0);
    std::size_t remaining = 0;
    for (NodeId s : sources) {
        if (s >= n) throw std::invalid_argument("node id out of range");
        if (!wanted[s]) {
            wanted[s] = 1;
            ++remaining;
        }
    }
    MinHeap heap;
    dist[target] = 0;
    heap.push(0, target);
    while (!heap.empty() && remaining > 0) {
        const MinHeap::Item top = heap.pop();
        const NodeId v = top.node;
        if (top.key != dist[v]) continue;
        if (wanted[v]) {
            wanted[v] = 0;
            --remaining;
        }
        // Backwards: follow edges u -> v in reverse, so dist[u] is u's time TO the target.
        for (std::uint32_t e = g.rev_offsets[v]; e < g.rev_offsets[v + 1]; ++e) {
            const NodeId u = g.rev_sources[e];
            const Dist nd = dist[v] + g.rev_weights[e];
            if (nd < dist[u]) {
                dist[u] = nd;
                heap.push(nd, u);
            }
        }
    }
    std::vector<Dist> out;
    out.reserve(sources.size());
    for (NodeId s : sources) out.push_back(dist[s]);
    return out;
}

Dist path_cost(const Graph& g, const std::vector<NodeId>& path) {
    Dist total = 0;
    for (std::size_t i = 1; i < path.size(); ++i) {
        Dist best = kInf;
        for (std::uint32_t e = g.offsets[path[i - 1]]; e < g.offsets[path[i - 1] + 1]; ++e) {
            if (g.targets[e] == path[i]) best = std::min<Dist>(best, g.weights[e]);
        }
        if (best == kInf) return kInf;
        total += best;
    }
    return total;
}

double path_length_m(const Graph& g, const std::vector<NodeId>& path) {
    double total = 0;
    for (std::size_t i = 1; i < path.size(); ++i) {
        for (std::uint32_t e = g.offsets[path[i - 1]]; e < g.offsets[path[i - 1] + 1]; ++e) {
            if (g.targets[e] == path[i]) {
                total += g.lengths_m[e];
                break;
            }
        }
    }
    return total;
}
