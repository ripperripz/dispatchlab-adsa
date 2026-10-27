# Optional: the project also builds with one command (see run.sh).
cmake_minimum_required(VERSION 3.16)
project(DispatchLabADSA LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_library(engine STATIC src/graph.cpp src/simulation.cpp src/server.cpp)
target_compile_options(engine PRIVATE -Wall -Wextra)

add_executable(dispatchlab src/main.cpp)
target_link_libraries(dispatchlab PRIVATE engine)

enable_testing()
add_executable(tests tests/tests.cpp)
target_link_libraries(tests PRIVATE engine)
add_test(NAME tests COMMAND tests)
