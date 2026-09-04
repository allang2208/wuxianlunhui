"""Measure approved Doubao sources before fixed-transform sprite production.

This is an offline source-analysis helper. It does not write runtime assets or
launch the game. The report records loop seam candidates, motion peaks and a
coarse foreground envelope so frame selection is reproducible.
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent
LOOP_ACTIONS = {"idle", "running"}


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_proxy_video(path: Path) -> tuple[list[np.ndarray], float, list[int]]:
    cap = cv2.VideoCapture(str(path))
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    original_size = [int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))]
    frames: list[np.ndarray] = []
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        frames.append(cv2.resize(bgr, (320, 180), interpolation=cv2.INTER_AREA))
    cap.release()
    if not frames or fps <= 0:
        raise RuntimeError(f"Cannot decode {path}")
    return frames, fps, original_size


def foreground_mask(frame: np.ndarray) -> np.ndarray:
    corners = np.concatenate(
        [frame[:12, :12].reshape(-1, 3), frame[:12, -12:].reshape(-1, 3)], axis=0
    )
    background = np.median(corners, axis=0)
    distance = np.linalg.norm(frame.astype(np.float32) - background, axis=2)
    mask = (distance > 20).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    kept = np.zeros_like(mask)
    for label in range(1, count):
        x, y, width, height, area = stats[label]
        if area < 18:
            continue
        if x > 282 and y > 148:
            continue
        kept[labels == label] = 1
    return kept


def masked_distance(a: np.ndarray, b: np.ndarray, ma: np.ndarray, mb: np.ndarray) -> float:
    union = (ma | mb).astype(bool)
    if not union.any():
        return 1.0
    rgb = np.abs(a.astype(np.float32) - b.astype(np.float32)).mean(axis=2) / 255.0
    color = float(rgb[union].mean())
    silhouette = float(np.count_nonzero(ma ^ mb) / np.count_nonzero(union))
    return color * 0.7 + silhouette * 0.3


def mask_bbox(mask: np.ndarray) -> list[int] | None:
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def save_seam_review(kind: str, frames: list[np.ndarray], pairs: list[dict]) -> str:
    tile_height = 204
    page = np.full((tile_height * len(pairs), 640, 3), 36, dtype=np.uint8)
    for row, pair in enumerate(pairs):
        for col, key in enumerate(("startFrame", "exclusiveEndFrame")):
            index = int(pair[key])
            y = row * tile_height
            page[y + 24 : y + 204, col * 320 : (col + 1) * 320] = frames[index]
            label = f"{kind} {key}={index}  seam score={pair['score']:.4f}"
            cv2.putText(
                page,
                label,
                (col * 320 + 5, y + 17),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.42,
                (255, 255, 255),
                1,
                cv2.LINE_AA,
            )
    relative = f"previews/{kind}-loop-seam-review.png"
    ok, encoded = cv2.imencode(".png", page)
    if not ok:
        raise RuntimeError(f"Cannot encode seam review for {kind}")
    encoded.tofile(ROOT / relative)
    return relative


def analyse_action(kind: str, video: Path) -> dict:
    frames, fps, original_size = read_proxy_video(video)
    masks = [foreground_mask(frame) for frame in frames]
    motion = [
        masked_distance(frames[i - 1], frames[i], masks[i - 1], masks[i])
        for i in range(1, len(frames))
    ]
    peaks = sorted(range(1, len(frames)), key=lambda i: motion[i - 1], reverse=True)[:12]
    result = {
        "video": video.relative_to(ROOT).as_posix(),
        "frameCount": len(frames),
        "fps": fps,
        "durationMs": len(frames) / fps * 1000,
        "originalSize": original_size,
        "proxySize": [320, 180],
        "coarseForegroundBboxesAtStep4": {
            str(i): mask_bbox(masks[i]) for i in range(0, len(frames), 4)
        },
        "motionPeaks": [
            {"frame": int(i), "timeMs": i / fps * 1000, "score": float(motion[i - 1])}
            for i in peaks
        ],
    }
    if kind in LOOP_ACTIONS:
        start_candidates = range(0, min(25, len(frames)))
        end_candidates = range(max(1, len(frames) - 25), len(frames))
        seams = []
        for start in start_candidates:
            for end in end_candidates:
                if end - start < int(fps * 3.5):
                    continue
                seams.append(
                    {
                        "startFrame": start,
                        "exclusiveEndFrame": end,
                        "spanFrames": end - start,
                        "spanMs": (end - start) / fps * 1000,
                        "score": masked_distance(frames[start], frames[end], masks[start], masks[end]),
                    }
                )
        seams.sort(key=lambda item: (-item["spanFrames"], item["score"]))
        full_span = [item for item in seams if item["spanFrames"] >= len(frames) - 4]
        best_score = sorted(seams, key=lambda item: item["score"])[:12]
        all_cycle_seams = []
        minimum_cycle_span = round(fps * 2)
        for start in range(0, len(frames) - minimum_cycle_span):
            for end in range(start + minimum_cycle_span, len(frames)):
                all_cycle_seams.append(
                    {
                        "startFrame": start,
                        "exclusiveEndFrame": end,
                        "spanFrames": end - start,
                        "spanMs": (end - start) / fps * 1000,
                        "score": masked_distance(frames[start], frames[end], masks[start], masks[end]),
                    }
                )
        best_two_seconds = sorted(all_cycle_seams, key=lambda item: item["score"])[:12]
        result["loopSeamCandidates"] = {
            "bestNearFullSpan": sorted(full_span, key=lambda item: item["score"])[:12],
            "bestScoreWithAtLeast3_5Seconds": best_score,
            "bestScoreWithAtLeastTwoSeconds": best_two_seconds,
            "scoreMeaning": "Lower is closer; 70% foreground RGB difference plus 30% silhouette XOR over a 320x180 proxy.",
        }
        review_pairs = [
            result["loopSeamCandidates"]["bestNearFullSpan"][0],
            result["loopSeamCandidates"]["bestScoreWithAtLeast3_5Seconds"][0],
            result["loopSeamCandidates"]["bestScoreWithAtLeastTwoSeconds"][0],
        ]
        result["loopSeamReview"] = save_seam_review(kind, frames, review_pairs)
    if kind == "attacking":
        warm_counts = []
        for i, frame in enumerate(frames):
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            warm = (hsv[..., 0] < 35) & (hsv[..., 1] > 115) & (hsv[..., 2] > 185)
            warm[:, :205] = False
            warm_counts.append((int(warm.sum()), i))
        result["warmVfxPeaks"] = [
            {"frame": i, "timeMs": i / fps * 1000, "pixelsAtProxy": count}
            for count, i in sorted(warm_counts, reverse=True)[:16]
        ]
    return result


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8-sig"))
    expected_status = "user_approved_source_video_for_sprite_production"
    if any(action["status"] != expected_status for action in manifest["actions"].values()):
        raise RuntimeError("All four current source videos must be user-approved before analysis.")
    actions = {
        kind: analyse_action(kind, ROOT / action["video"])
        for kind, action in manifest["actions"].items()
    }
    write_json(
        ROOT / "source-analysis.json",
        {
            "unitKey": manifest["unitKey"],
            "sourceManifest": "manifest.json",
            "analysisOnly": True,
            "runtimeIntegrationActive": False,
            "actions": actions,
        },
    )
    print("Wrote source-analysis.json for idle, running, attacking and dying.", flush=True)


if __name__ == "__main__":
    main()
