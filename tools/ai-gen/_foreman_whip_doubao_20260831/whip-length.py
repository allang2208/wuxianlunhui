"""Bound an AI-stretched whip without rescaling or redrawing the actor."""
import heapq
import math
import cv2
import numpy as np


def skeleton(mask):
    work = mask.astype(np.uint8) * 255
    result = np.zeros_like(work)
    element = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    while np.any(work):
        eroded = cv2.erode(work, element)
        result |= cv2.subtract(work, cv2.dilate(eroded, element))
        work = eroded
    return result > 0


def normalize_whip(rgba, target_length):
    alpha = rgba[..., 3]
    mask = (alpha > 8).astype(np.uint8)
    core = cv2.morphologyEx((alpha > 80).astype(np.uint8), cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(core, 8)
    body_label = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    core = (labels == body_label).astype(np.uint8)
    bx, by, bw, bh, _ = [int(value) for value in stats[body_label]]
    protected = cv2.dilate(core, np.ones((5, 5), np.uint8))
    thin = mask & (1 - protected)
    thin = cv2.morphologyEx(thin, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) & (1 - protected)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(thin, 8)
    candidates = [i for i in range(1, count) if max(stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]) > bh * .35]
    if not candidates:
        raise ValueError("Cannot isolate the whip; do not alter the actor")
    chosen = max(candidates, key=lambda i: max(stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]))
    whip = (labels == chosen).astype(np.uint8)
    yy, xx = np.where(whip)
    body_distance = cv2.distanceTransform(1 - protected, cv2.DIST_L2, 5)
    cost = body_distance[yy, xx].copy()
    cost += np.maximum(0, yy - (by + bh * .77)) * 5
    candidate = int(np.argmin(cost))
    base = (int(xx[candidate]), int(yy[candidate]))
    skel = skeleton(whip)
    sy, sx = np.where(skel)
    start_index = int(np.argmin((sx - base[0]) ** 2 + (sy - base[1]) ** 2))
    start = (int(sy[start_index]), int(sx[start_index]))
    # Use a one-pixel graph; closing above reconnects codec/alpha pinholes.
    traversable = cv2.dilate(skel.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    distances = {start: 0.0}
    queue = [(0.0, *start)]
    h, w = alpha.shape
    while queue:
        distance, y, x = heapq.heappop(queue)
        if distance > distances[(y, x)]:
            continue
        for dy, dx in ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)):
            ny, nx = y + dy, x + dx
            if not (0 <= ny < h and 0 <= nx < w and traversable[ny, nx]):
                continue
            length = distance + (math.sqrt(2) if dx and dy else 1)
            if length < distances.get((ny, nx), math.inf):
                distances[(ny, nx)] = length
                heapq.heappush(queue, (length, ny, nx))
    length = max(distances.values())
    if length < bh * .35:
        raise ValueError("Whip graph is incomplete; inspect before scaling")
    ratio = target_length / length
    # Only source whip pixels are moved. Keep a small overlap at the handle.
    region = cv2.dilate(whip, np.ones((3, 3), np.uint8)) & (1 - protected)
    layer = rgba.copy()
    layer[region == 0] = 0
    actor = rgba.copy()
    actor[region != 0] = 0
    premul = layer.astype(np.float32)
    premul[..., :3] *= premul[..., 3:4] / 255
    matrix = np.float32([[ratio, 0, base[0] * (1 - ratio)], [0, ratio, base[1] * (1 - ratio)]])
    moved = cv2.warpAffine(premul, matrix, (w, h), flags=cv2.INTER_LANCZOS4)
    a = np.clip(moved[..., 3:4], 0, 255) / 255
    actor_a = actor[..., 3:4].astype(np.float32) / 255
    out_a = a + actor_a * (1 - a)
    color = np.clip(moved[..., :3], 0, 255) + actor[..., :3] * actor_a * (1 - a)
    color /= np.maximum(out_a, 1 / 255)
    output = np.dstack((np.clip(color, 0, 255), out_a[..., 0] * 255)).astype(np.uint8)
    output[output[..., 3] < 3] = 0
    return output, {"attachmentXY": list(base), "sourceVisibleArcLength": length, "targetArcLength": target_length, "weaponScale": ratio, "weaponPixelCount": int(region.sum()), "bodyTransform": "none; only isolated whip pixels are transformed"}
