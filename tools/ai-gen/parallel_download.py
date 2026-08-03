#!/usr/bin/env python3
"""Parallel chunked downloader (multi-connection) for slow/blocked networks.

Usage:
    python parallel_download.py <url> <output_path> [connections] [chunk_mb]

Downloads a file using N parallel HTTP Range requests and reassembles it.
Suitable for large files on servers that throttle single connections.
"""

import argparse
import concurrent.futures as cf
import os
import shutil
import sys
import time
import urllib.error
import urllib.request

CHUNK_RETRIES = 5


def http_get(url, headers=None, timeout=60):
    req = urllib.request.Request(url, headers=headers or {})
    return urllib.request.urlopen(req, timeout=timeout)


def content_length(url):
    with http_get(url, headers={"Range": "bytes=0-0"}, timeout=60) as resp:
        total = resp.headers.get("Content-Range")
        if total and "/" in total:
            return int(total.rsplit("/", 1)[1])
        return int(resp.headers.get("Content-Length", 0))


def download_chunk(url, start, end, part_path, idx, total_chunks):
    for attempt in range(1, CHUNK_RETRIES + 1):
        try:
            headers = {"Range": f"bytes={start}-{end}"}
            with http_get(url, headers=headers, timeout=120) as resp, open(part_path, "wb") as fh:
                shutil.copyfileobj(resp, fh, length=1024 * 256)
            size = os.path.getsize(part_path)
            expected = end - start + 1
            if size != expected:
                raise IOError(f"chunk {idx} size {size} != expected {expected}")
            return True
        except Exception as exc:  # noqa: BLE001
            if attempt == CHUNK_RETRIES:
                raise
            print(f"  chunk {idx}/{total_chunks} attempt {attempt} failed ({exc}); retrying", flush=True)
            time.sleep(2 * attempt)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("output")
    ap.add_argument("--connections", type=int, default=8)
    ap.add_argument("--chunk-mb", type=int, default=64)
    args = ap.parse_args()

    url = args.url
    out = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(out), exist_ok=True) if os.path.dirname(out) else None

    print(f"Resolving size: {url}", flush=True)
    total = content_length(url)
    print(f"Total: {total / (1024 ** 3):.2f} GiB", flush=True)

    chunk_bytes = args.chunk_mb * 1024 * 1024
    ranges = []
    start = 0
    idx = 0
    while start < total:
        end = min(start + chunk_bytes - 1, total - 1)
        ranges.append((start, end))
        start = end + 1
        idx += 1
    if ranges and ranges[-1][1] < total - 1:
        ranges[-1] = (ranges[-1][0], total - 1)

    n = len(ranges)
    print(f"Splitting into {n} chunks, {args.connections} parallel connections", flush=True)
    parts_dir = out + ".parts"
    os.makedirs(parts_dir, exist_ok=True)

    t0 = time.time()
    last_report = [0]
    done = [0]

    def work(item):
        i, (s, e) = item
        part = os.path.join(parts_dir, f"part-{i:05d}.bin")
        download_chunk(url, s, e, part, i + 1, n)
        done[0] += 1
        dt = time.time() - t0
        if dt > 0 and done[0] % max(1, n // 20) == 0:
            speed = done[0] * chunk_bytes / dt
            print(f"  progress {done[0]}/{n} chunks, {speed / 1e6:.1f} MB/s", flush=True)
        return part

    with cf.ThreadPoolExecutor(max_workers=args.connections) as pool:
        list(pool.map(work, enumerate(ranges)))

    print("Assembling parts...", flush=True)
    with open(out, "wb") as out_fh:
        for i in range(n):
            part = os.path.join(parts_dir, f"part-{i:05d}.bin")
            with open(part, "rb") as fh:
                shutil.copyfileobj(fh, out_fh, length=1024 * 1024)
            os.remove(part)
    os.rmdir(parts_dir)

    actual = os.path.getsize(out)
    elapsed = time.time() - t0
    print(f"Done: {actual} bytes in {elapsed:.1f}s ({actual / 1e6 / elapsed:.1f} MB/s)", flush=True)
    if actual != total:
        print(f"WARNING: size mismatch expected {total}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
