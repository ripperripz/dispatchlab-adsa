// Road graph, binary min-heap and Dijkstra's algorithm.
#pragma once

#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using NodeId = std::uint32_t;
using Dist = std::uint64_t;  // travel time in milliseconds

constexpr Dist kInf = std::numeric_limits<Dist>::max();
constexpr NodeId kNoNode = std::numeric_limits<NodeId>::max();

// ------------------------------------------------------------------ graph

// Directed road graph in Compressed Sparse Row (CSR) form.
// The out-edges of node u are positions offsets[u] .. offsets[u+1]-1 of the
// edge arrays. The reverse arrays hold the same edges grouped by target, so a
// search can also run backwards ("who can reach v, and how fast?").
struct Graph {
    std::vector<double> lat, lon;  // per node, degrees

    std::vector<std::uint32_t> offsets;    // size n + 1
    std::vector<NodeId> targets;           // size m
    std::vector<std::uint32_t> weights;    // travel time in ms, size m
    std::vector<float> lengths_m;          // size m
    std::vector<std::uint8_t> arterial;    // 1 for main roads (drawing only), size m

    std::vector<std::uint32_t> rev_offsets;  // size n + 1
    std::vector<NodeId> rev_sources;         // size m
    std::vector<std::uint32_t> rev_weights;  // size m

    std::uint32_t max_speed_kmh = 0;

    std::uint32_t num_nodes() const { return static_cast<std::uint32_t>(lat.size()); }
    std::uint32_t num_edges() const { return static_cast<std::uint32_t>(targets.size()); }
};

// One directed edge, used to build a graph.
struct Edge {
    NodeId from, to;
    std::uint32_t weight_ms;
    float length_m;
    std::uint8_t arterial;
};

// Builds the forward and reverse CSR arrays from an edge list.
Graph build_graph(std::vector<double> lat, std::vector<double> lon, std::vector<Edge> edges);

// Reads the text format written by tools/export_graph.py.
Graph load_graph(const std::string& path);

// Great-circle distance between two nodes, in metres.
double distance_m(const Graph& g, NodeId a, NodeId b);

// ------------------------------------------------------------------ heap

// Binary min-heap of (key, node) pairs, stored in an array: the children of
// position i are 2i+1 and 2i+2, and every parent is <= its children.
// push and pop are O(log n). Equal keys are ordered by node id, so results
// never depend on insertion order.
class MinHeap {
public:
    struct Item {
        Dist key;
        NodeId node;
        bool operator<(const Item& o) const { return key < o.key || (key == o.key && node < o.node); }
    };

    bool empty() const { return items_.empty(); }
    std::size_t size() const { return items_.size(); }
    void clear() { items_.clear(); }
    const Item& top() const { return items_.front(); }
    void push(Dist key, NodeId node);
    Item pop();  // removes and returns the smallest item

private:
    std::vector<Item> items_;
};

// ------------------------------------------------------------------ Dijkstra

struct RouteResult {
    Dist cost = kInf;              // kInf if the target cannot be reached
    std::vector<NodeId> path;      // source .. target
    std::vector<NodeId> settled;   // nodes in the order Dijkstra finalized them (for drawing)
    std::uint32_t settled_count = 0;
    std::uint32_t relaxed_count = 0;
    bool reachable() const { return cost != kInf; }
};

// Shortest path from s to t. Stops as soon as t is settled.
// `keep_trace` records the settle order for the routing lab animation.
RouteResult dijkstra(const Graph& g, NodeId s, NodeId t, bool keep_trace = false);

// Travel time from every node in `sources` TO `target`, with one Dijkstra run
// backwards from the target over the reverse edges. Stops once every source is
// settled. Used by the Greedy ETA policy.
std::vector<Dist> dijkstra_to_target(const Graph& g, NodeId target, const std::vector<NodeId>& sources);

// Sum of edge weights along a path, or kInf if two consecutive nodes are not
// connected. Used to check that a returned path really costs what was reported.
Dist path_cost(const Graph& g, const std::vector<NodeId>& path);
double path_length_m(const Graph& g, const std::vector<NodeId>& path);
