#!/usr/bin/env bash
# Builds and runs the tests.
set -euo pipefail
cd "$(dirname "$0")"
CXX="${CXX:-c++}"
mkdir -p build
"$CXX" -std=c++20 -O2 -Wall -Wextra -o build/tests tests/tests.cpp src/graph.cpp src/simulation.cpp src/server.cpp
./build/tests
