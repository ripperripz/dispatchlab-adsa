# CLAUDE.md: DispatchLab · Dijkstra edition

Classroom (ADSA) edition of DispatchLab: Dijkstra routing and a delivery simulation on the Tricity
road network, with the same console UI as the full project. Scope and decisions are in `plan.md`.

## Commands

```bash
./run.sh              # build if needed, serve on http://127.0.0.1:8080, open the browser
./test.sh             # build and run tests/tests.cpp
c++ -std=c++20 -O2 -o build/dispatchlab src/*.cpp   # the whole build
```

## Layout

* `src/graph.*`: CSR graph (forward and reverse), text loader, `MinHeap`, `dijkstra`,
  `dijkstra_to_target`.
* `src/simulation.*`: `generate_scenario`, the event-driven `Simulator`, Nearest and Greedy ETA.
* `src/server.*`: single-threaded loopback HTTP server, JSON writer, endpoints `/api/info`,
  `/api/network`, `/api/route`, `/api/simulate`, `/api/compare`, plus static files from `web/`.
* `src/main.cpp`: CLI (`serve`, `route`, `simulate`).
* `web/`: plain JS console. `api.js` is the only file that calls `fetch` (relative `/api/` paths).
  `core.js` is pure replay logic (format `dispatchlab-replay-1`). One file per page in `web/views/`.

## Conventions

* Keep the scope to syllabus algorithms: no A*, bidirectional search or contraction hierarchies.
* Keep the C++ file count small; add code to the existing files unless a new file is clearly needed.
* Travel times are integer milliseconds. Ties are broken by node or courier id, so runs are
  deterministic. Sample randomness from raw `std::mt19937_64` output, never from
  `std::*_distribution` (its results differ between standard libraries).
* Every change to the engine needs a test in `tests/tests.cpp`, and `./test.sh` must pass.
* The console stays plain HTML, CSS and JavaScript with no build step.
