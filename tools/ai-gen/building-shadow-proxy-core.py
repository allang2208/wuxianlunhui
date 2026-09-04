#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pure geometry core for World-122 semantic building shadow proxies."""

from __future__ import annotations

import math


EPSILON = 1e-7


def _cross(origin, left, right):
    return ((left[0] - origin[0]) * (right[1] - origin[1])
            - (left[1] - origin[1]) * (right[0] - origin[0]))


def convex_hull(points):
    unique = sorted({(float(point[0]), float(point[1])) for point in points})
    if len(unique) <= 2:
        return unique
    lower = []
    for point in unique:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], point) <= EPSILON:
            lower.pop()
        lower.append(point)
    upper = []
    for point in reversed(unique):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], point) <= EPSILON:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def polygon_area(points):
    if len(points) < 3:
        return 0.0
    twice = 0.0
    for index, point in enumerate(points):
        following = points[(index + 1) % len(points)]
        twice += point[0] * following[1] - following[0] * point[1]
    return abs(twice) * 0.5


def simplify_convex_polygon(points, max_points=12):
    result = list(points)
    while len(result) > max(3, int(max_points)):
        remove_index = min(
            range(len(result)),
            key=lambda index: abs(_cross(
                result[index - 1],
                result[index],
                result[(index + 1) % len(result)],
            )),
        )
        result.pop(remove_index)
    return result


def _bounds(points):
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def _bounds_gap(left, right):
    dx = max(0.0, left[0] - right[2], right[0] - left[2])
    dy = max(0.0, left[1] - right[3], right[1] - left[3])
    return math.hypot(dx, dy)


def _cluster_records(records, gap):
    parents = list(range(len(records)))

    def find(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left, right):
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    for left_index, left in enumerate(records):
        for right_index in range(left_index + 1, len(records)):
            right = records[right_index]
            same_group = bool(left.get("group") and left.get("group") == right.get("group"))
            if same_group or _bounds_gap(left["bounds"], right["bounds"]) <= gap:
                union(left_index, right_index)

    clusters = {}
    for index, record in enumerate(records):
        clusters.setdefault(find(index), []).append(record)
    return list(clusters.values())


def _normalized_polygon(points, foundation_width, foundation_depth, max_points):
    hull = simplify_convex_polygon(convex_hull(points), max_points)
    return [
        [round(point[0] / foundation_width, 6),
         round(point[1] / foundation_depth, 6)]
        for point in hull
    ]


def _polygon_signature(points):
    return "|".join(f"{point[0]:.5f},{point[1]:.5f}" for point in points)


def build_shadow_proxy(mesh_records, foundation_width, foundation_depth,
                       ground_z, *, band_count=4, cluster_gap_ratio=0.0125,
                       max_points=12, max_parts=32):
    """Build normalized XY proxy parts from evaluated model mesh records.

    Input points are root-local XY coordinates. Output polygons remain normalized
    to the authored foundation so the runtime generator can map them to either a
    2x2 or 4x4 logical diamond without depending on the final PNG crop.
    """
    foundation_width = float(foundation_width)
    foundation_depth = float(foundation_depth)
    ground_z = float(ground_z)
    if foundation_width <= 0 or foundation_depth <= 0:
        raise ValueError("foundation dimensions must be positive")
    band_count = max(1, min(8, int(band_count)))

    prepared = []
    excluded = []
    for source in mesh_records:
        role = str(source.get("role") or "body").lower()
        name = str(source.get("name") or f"mesh_{len(prepared)}")
        if role in ("ground", "ignore"):
            excluded.append({"name": name, "role": role})
            continue
        points = convex_hull(source.get("points") or [])
        if len(points) < 3 or polygon_area(points) <= EPSILON:
            continue
        z_min = max(ground_z, float(source.get("zMin", ground_z)))
        z_max = float(source.get("zMax", ground_z))
        if z_max <= ground_z + EPSILON or z_max <= z_min + EPSILON:
            continue
        prepared.append({
            "name": name,
            "group": source.get("group"),
            "points": points,
            "bounds": _bounds(points),
            "zMin": z_min,
            "zMax": z_max,
        })
    if not prepared:
        raise ValueError("no renderable body meshes remain after semantic filtering")

    model_top = max(record["zMax"] for record in prepared)
    model_height = model_top - ground_z
    gap = min(foundation_width, foundation_depth) * float(cluster_gap_ratio)
    minimum_area = foundation_width * foundation_depth * 0.00035
    parts = []
    last_by_signature = {}
    lowest_band_records = []

    for band_index in range(band_count):
        low_ratio = band_index / band_count
        high_ratio = (band_index + 1) / band_count
        low_z = ground_z + model_height * low_ratio
        high_z = ground_z + model_height * high_ratio
        active = [record for record in prepared
                  if record["zMax"] > low_z + EPSILON
                  and record["zMin"] < high_z - EPSILON]
        if not active:
            continue
        if not lowest_band_records:
            lowest_band_records = list(active)
        clusters = _cluster_records(active, gap)
        clusters.sort(key=lambda cluster: (
            min(record["bounds"][0] for record in cluster),
            min(record["bounds"][1] for record in cluster),
        ))
        for cluster in clusters:
            points = [point for record in cluster for point in record["points"]]
            hull = convex_hull(points)
            area = polygon_area(hull)
            tallest = max(record["zMax"] for record in cluster) - ground_z
            if area < minimum_area and tallest < model_height * 0.22:
                continue
            polygon = _normalized_polygon(
                hull, foundation_width, foundation_depth, max_points)
            if len(polygon) < 3:
                continue
            signature = _polygon_signature(polygon)
            previous = last_by_signature.get(signature)
            if previous is not None and abs(previous["topRatio"] - low_ratio) <= EPSILON:
                previous["topRatio"] = round(high_ratio, 6)
                continue
            part = {
                "id": f"band_{band_index + 1:02d}_cluster_{len(parts) + 1:02d}",
                "polygon": polygon,
                "baseRatio": round(low_ratio, 6),
                "topRatio": round(high_ratio, 6),
            }
            parts.append(part)
            last_by_signature[signature] = part

    if not parts:
        raise ValueError("semantic height bands produced no shadow parts")
    if len(parts) > max_parts:
        raise ValueError(f"semantic height bands produced {len(parts)} parts; limit is {max_parts}")

    contact_points = [point for record in lowest_band_records for point in record["points"]]
    contact_polygon = _normalized_polygon(
        contact_points, foundation_width, foundation_depth, max_points)
    if len(contact_polygon) < 3:
        raise ValueError("semantic proxy has no stable contact polygon")

    return {
        "modelHeight": round(model_height, 6),
        "contactPolygon": contact_polygon,
        "parts": parts,
        "bodyObjectCount": len(prepared),
        "excludedObjectCount": len(excluded),
        "excludedObjects": excluded,
        "bandCount": band_count,
        "clusterGapRatio": float(cluster_gap_ratio),
    }
