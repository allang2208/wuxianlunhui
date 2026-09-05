#!/usr/bin/env python3
"""Transfer only the perspective-corrected mall sign onto the accepted body."""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter


HERE = Path(__file__).resolve().parent
TARGET_PATH = HERE / "grand_mall_sign_only_candidate_v02.png"
DONOR_PATH = HERE / "grand_mall_sign_aligned_source_v03.png"
OUTPUT_PATH = HERE / "grand_mall_sign_only_candidate_v03.png"

# The donor is an image edit whose board follows the right-facade floor lines.
# Transfer the union of the old and corrected board contours.  This is just
# large enough to clear the old angle and draw the aligned board; nearby windows
# and facade pixels remain sourced from the accepted target.
PATCH_QUADS = (
    np.int32([[370, 503], [506, 470], [518, 552], [368, 594]]),
    np.int32([[378, 541], [498, 488], [502, 542], [377, 598]]),
)


def feature_mask(image: np.ndarray, alpha: np.ndarray | None, donor: bool) -> np.ndarray:
    if alpha is not None:
        mask = np.where(alpha > 8, 255, 0).astype(np.uint8)
    else:
        # Exclude the baked gray checkerboard surrounding the generated donor.
        spread = image.max(axis=2).astype(np.int16) - image.min(axis=2).astype(np.int16)
        mask = np.where((spread > 5) | (image.min(axis=2) < 195), 255, 0).astype(np.uint8)

    if donor:
        cv2.rectangle(mask, (650, 835), (960, 1090), 0, -1)
    else:
        cv2.rectangle(mask, (330, 430), (545, 630), 0, -1)
    return mask


def align_donor(donor: np.ndarray, target: np.ndarray) -> np.ndarray:
    sift = cv2.SIFT_create(nfeatures=6000)
    donor_gray = cv2.cvtColor(donor, cv2.COLOR_RGB2GRAY)
    target_gray = cv2.cvtColor(target[..., :3], cv2.COLOR_RGB2GRAY)
    donor_mask = feature_mask(donor, None, True)
    target_mask = feature_mask(target[..., :3], target[..., 3], False)
    donor_keys, donor_desc = sift.detectAndCompute(donor_gray, donor_mask)
    target_keys, target_desc = sift.detectAndCompute(target_gray, target_mask)
    matches = cv2.BFMatcher(cv2.NORM_L2).knnMatch(donor_desc, target_desc, k=2)
    good = [first for first, second in matches if first.distance < 0.68 * second.distance]
    if len(good) < 12:
        raise RuntimeError(f"insufficient alignment matches: {len(good)}")

    donor_points = np.float32([donor_keys[m.queryIdx].pt for m in good])
    target_points = np.float32([target_keys[m.trainIdx].pt for m in good])
    homography, inliers = cv2.findHomography(
        donor_points, target_points, cv2.RANSAC, 3.0
    )
    if homography is None or inliers is None or int(inliers.sum()) < 10:
        raise RuntimeError("could not establish a stable donor-to-target homography")
    print(f"alignment matches={len(good)} inliers={int(inliers.sum())}")
    return cv2.warpPerspective(
        donor,
        homography,
        (target.shape[1], target.shape[0]),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REFLECT,
    )


def main() -> None:
    target = np.asarray(Image.open(TARGET_PATH).convert("RGBA"))
    donor = np.asarray(Image.open(DONOR_PATH).convert("RGB"))
    aligned = align_donor(donor, target)

    patch_mask = np.zeros(target.shape[:2], dtype=np.uint8)
    for patch_quad in PATCH_QUADS:
        cv2.fillConvexPoly(patch_mask, patch_quad, 255)
    patch_mask = np.asarray(
        Image.fromarray(patch_mask).filter(ImageFilter.GaussianBlur(2.0))
    )
    blend_alpha = (patch_mask.astype(np.float32) / 255.0)[..., None]
    composed_rgb = np.clip(
        aligned.astype(np.float32) * blend_alpha
        + target[..., :3].astype(np.float32) * (1.0 - blend_alpha),
        0,
        255,
    ).astype(np.uint8)
    composed = np.dstack((composed_rgb, target[..., 3]))
    Image.fromarray(composed, "RGBA").save(OUTPUT_PATH, optimize=True)
    print(f"wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
