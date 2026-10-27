#!/usr/bin/env bash
# Builds the engine (if needed) and starts the console on http://127.0.0.1:8080.
#   ./run.sh            # default port 8080
#   ./run.sh 9000       # another port
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-8080}"
CXX="${CXX:-c++}"

# Rebuild when any source file is newer than the program.
if [ ! -x build/dispatchlab ] || [ -n "$(find src -newer build/dispatchlab -print -quit)" ]; then
    echo "Building..."
    mkdir -p build
    "$CXX" -std=c++20 -O2 -Wall -Wextra -o build/dispatchlab src/*.cpp
fi

# Open the browser once the server is up (macOS: open, Linux: xdg-open).
( sleep 1.5
  if command -v open >/dev/null 2>&1; then open "http://127.0.0.1:$PORT"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://127.0.0.1:$PORT" >/dev/null 2>&1
  fi ) &

exec ./build/dispatchlab serve --port "$PORT"
