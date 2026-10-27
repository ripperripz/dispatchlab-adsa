// A small HTTP server for the console: serves the files in web/ and answers
// JSON requests under /api/. One request at a time, loopback (127.0.0.1) only.
#pragma once

#include <map>
#include <string>

#include "graph.hpp"

struct Request {
    std::string path;                          // e.g. "/api/route"
    std::map<std::string, std::string> query;  // e.g. {"s": "17", "t": "90001"}
};

struct Response {
    int status = 200;
    std::string content_type = "application/json";
    std::string body;
};

// Answers one request (also used directly by the tests, without sockets).
Response handle_request(const Graph& g, const std::string& web_root, const Request& req);

// Parses "/api/route?s=1&t=2" into a Request.
Request parse_target(const std::string& target);

// Listens on 127.0.0.1:port and serves until the process is stopped.
void serve(const Graph& g, const std::string& web_root, int port);
