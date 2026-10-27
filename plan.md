# Plan: DispatchLab ADSA edition

A smaller version of DispatchLab for an Advanced Data Structures and Algorithms class, where the
syllabus covers Dijkstra's algorithm but not A*, bidirectional search or contraction hierarchies.

## Goals

* Same look and feel as the full DispatchLab console.
* Only syllabus algorithms: a hand-written binary min-heap and Dijkstra's algorithm.
* As few C++ files as possible, no third-party libraries, builds with one compiler command.
* Still a real application: real Tricity roads, a routing lab and a delivery simulation.

## Scope

Kept (simplified):

* Road graph in CSR form (forward and reverse), loaded from a plain text file.
* Binary min-heap and Dijkstra (point-to-point with a search trace, and one-to-many on the reverse
  graph).
* A discrete-event delivery simulation with a priority queue of events, and two dispatch policies:
  Nearest (straight-line distance) and Greedy ETA (road times from one reverse Dijkstra).
* A single-threaded HTTP server serving the console and a small JSON API.
* The console: Overview, Routing lab (Dijkstra only), Simulation, and Policies (head-to-head).

Removed from the full project: A*, bidirectional Dijkstra, CCH, OSM import (the graph ships as text),
SCC computation (the exported graph is already strongly connected), traffic scenarios, ETA strategy
research, replay and state hashing, benchmarks, experiment runner, demo export, `verify.sh`.

## Files

| File | Contents |
|---|---|
| `src/graph.hpp`, `src/graph.cpp` | Graph, loader, binary heap, Dijkstra |
| `src/simulation.hpp`, `src/simulation.cpp` | Scenario generator, event queue, simulator, policies |
| `src/server.hpp`, `src/server.cpp` | HTTP server and JSON API |
| `src/main.cpp` | CLI: `serve`, `route`, `simulate` |
| `tests/tests.cpp` | Heap, Dijkstra (vs brute force), simulation rules |
| `web/` | The console (plain HTML, CSS, JS; no build step) |
| `data/tricity.graph.txt` | Road graph exported from the full project |
| `tools/export_graph.py` | One-off converter from the full project's binary graph |

## Steps

1. Export the graph to text.
2. Write the engine (graph and Dijkstra, simulation, server, main).
3. Trim the console to four views and wire it to the API.
4. Tests, `run.sh`, `test.sh`, README, CLAUDE.md.
5. Build, run tests, check every page in a browser, commit.
