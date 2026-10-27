# DispatchLab · Dijkstra edition

Shortest-path routing and food-delivery dispatch on the real road network of Chandigarh, Mohali
and Panchkula, built around one algorithm: **Dijkstra's algorithm with a hand-written binary
heap**. A C++20 engine does the work; a browser console shows it.

This is the classroom (ADSA) edition of DispatchLab: the same idea and the same interface, with only
syllabus algorithms and a small codebase.

## Run it

You need a C++20 compiler (`g++` 10+ or `clang++` 12+). Nothing else to install.

```bash
./run.sh
```

It builds the engine on the first run, starts it, and opens http://127.0.0.1:8080. Stop it with
Ctrl+C. The server only accepts connections from your own computer.

Without the script, the whole build is one command:

```bash
c++ -std=c++20 -O2 -o build/dispatchlab src/*.cpp
```

Run the tests:

```bash
./test.sh
```

## What the console shows

| Page | What happens |
|---|---|
| **Overview** | The road network (142,425 intersections, 298,112 one-way road segments) and how the engine works |
| **Routing lab** | Click two points. Dijkstra finds the fastest route, and the map replays every node it settled, in order |
| **Simulation** | Orders arrive at restaurants, food is cooked, couriers drive and deliver. Play it back on the map |
| **Policies** | Two ways to pick a courier, compared on the same scenario |

## The algorithms

**Road graph (CSR).** Each intersection is a node and each one-way road segment a directed edge,
weighted by its travel time in milliseconds. Edges are stored in compressed sparse row form: one
array of all edge targets, plus `offsets[u]` marking where node `u`'s edges start. A reverse copy
groups edges by their target so searches can also run backwards.

**Binary min-heap.** A priority queue stored in an array; the children of position `i` are `2i+1`
and `2i+2`. `push` and `pop` are O(log n). Dijkstra uses "lazy deletion": when a shorter distance to a
node is found, the node is pushed again, and outdated entries are skipped when popped.

**Dijkstra.** Repeatedly take the closest unsettled node from the heap, mark its distance final, and
relax its outgoing edges. With non-negative weights, the first time the target comes out of the heap
its distance is the shortest. Complexity O((V + E) log V). The engine also runs Dijkstra **backwards
from a restaurant** over the reverse edges, which gives every courier's travel time to it in one
search.

**Delivery simulation.** A discrete-event simulation: events (order created, food ready, courier
assigned, arrived, picked up, delivered, available) wait in a priority queue ordered by time. The
simulator pops the next event, updates the world, and schedules what follows. Every courier trip is a
Dijkstra query.

**Dispatch policies.**

* *Nearest*: the free courier closest to the restaurant in a straight line.
* *Greedy ETA*: the courier with the earliest delivery time,
  `ETA = max(now + T(courier → restaurant), food ready) + T(restaurant → customer)`, with every
  `T(courier → restaurant)` from one backward Dijkstra.

## Project layout

```
src/graph.hpp, graph.cpp            road graph (CSR), binary heap, Dijkstra
src/simulation.hpp, simulation.cpp  scenario, event queue, simulator, dispatch policies
src/server.hpp, server.cpp          HTTP server and JSON API for the console
src/main.cpp                        command line: serve, route, simulate
tests/tests.cpp                     heap, Dijkstra vs Floyd-Warshall, simulation, API
web/                                the console (HTML, CSS, JavaScript; no build step)
data/tricity.graph.txt              the road network as plain text
tools/export_graph.py               how the data file was produced
```

## Command line

```bash
./build/dispatchlab route 17 90001
./build/dispatchlab simulate --policy greedy_eta --couriers 40 --orders 300 --seed 42
./build/dispatchlab serve --port 8080
```

## How it is tested

`tests/tests.cpp` checks that:

* the heap pops 5,000 random items in sorted order;
* Dijkstra returns exactly the Floyd–Warshall (brute force) distance for every pair on 20 random
  graphs, and every returned path's edge times add up to the reported cost;
* the backward search agrees with individual forward queries;
* every simulated order is delivered, events follow the legal order (created → assigned → picked up
  → delivered, never before the food is ready), and the same scenario always gives the same log;
* the API rejects bad input and paths outside `web/`.

## Data

The road network comes from OpenStreetMap (© OpenStreetMap contributors, ODbL), via the Geofabrik
extract of 17 Oct 2026, clipped to the Tricity area. Only roads drivable by delivery vehicles are
kept, and only the largest part in which every intersection can reach every other. Travel times use
fixed speeds per road type (for example 60 km/h on trunk roads, 20 km/h on residential streets).

## Fonts

Geist and Geist Mono (SIL Open Font License), in `web/fonts/`.
