#!/usr/bin/env python3
"""Converts a full DispatchLab binary graph (DLGRAPH1) into the plain text format
used by this project. One-off tool: the result is committed as data/tricity.graph.txt.

usage: python3 tools/export_graph.py <in.graph> <out.graph.txt>

Output format (whitespace separated):
    # comment lines
    n m max_speed_kmh
    lat lon                                   (n lines, node 0 .. n-1)
    from to weight_ms length_m arterial       (m lines, directed edges)
"""
import struct
import sys

# Road classes 0..7 (motorway .. secondary_link) are arterial in the full project.
ARTERIAL_CLASSES = 8


def main(src, dst):
    data = open(src, "rb").read()
    if data[:8] != b"DLGRAPH1":
        sys.exit("not a DLGRAPH1 file")
    pos = 8
    _version, n, m, vmax = struct.unpack_from("<IIII", data, pos)
    pos += 16
    (label_len,) = struct.unpack_from("<Q", data, pos)
    pos += 8
    label = data[pos:pos + label_len].decode()
    pos += label_len

    def arr(fmt, count):
        nonlocal pos
        size = struct.calcsize("<" + fmt)
        out = struct.unpack_from("<%d%s" % (count, fmt), data, pos)
        pos += size * count
        return out

    offsets = arr("I", n + 1)
    targets = arr("I", m)
    weights = arr("I", m)
    lengths_mm = arr("I", m)
    road_class = arr("B", m)
    lat = arr("d", n)
    lon = arr("d", n)

    with open(dst, "w") as f:
        f.write("# DispatchLab road graph: %s\n" % label)
        f.write("# n m max_speed_kmh / n lines 'lat lon' / m lines 'from to weight_ms length_m arterial'\n")
        f.write("%d %d %d\n" % (n, m, vmax))
        for i in range(n):
            f.write("%.6f %.6f\n" % (lat[i], lon[i]))
        for u in range(n):
            for e in range(offsets[u], offsets[u + 1]):
                arterial = 1 if road_class[e] < ARTERIAL_CLASSES else 0
                f.write("%d %d %d %.1f %d\n" % (u, targets[e], weights[e], lengths_mm[e] / 1000.0, arterial))
    print("wrote %s: %d nodes, %d edges, v_max %d km/h" % (dst, n, m, vmax))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
