#!/usr/bin/env python3
"""Replace the rejected generated mall lettering with the accepted three-coin sign."""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[4]
SOURCE = (
    ROOT
    / "tools/ai-gen/_settlement_building_pack_20260821/grand_mall"
    / "grand_mall_refine_v02_notext_body.png"
)
TARGET = (
    ROOT
    / "tools/ai-gen/_klein_dev_replacement_20260826/batch_03"
    / "model_plus_original_36/grand_mall/grand_mall_refine_v01_body.png"
)
OUTPUT = TARGET.with_name("grand_mall_refine_v01_notext_body.png")

# Four matching outer-board corners, clockwise from upper left.  The source is
# the already accepted three-coin board; the target is the low-redraw Klein
# candidate whose generated lettering was rejected during visual review.
SOURCE_QUAD = np.float32([[602, 610], [713, 573], [719, 631], [599, 670]])
TARGET_QUAD = np.float32([[582, 649], [718, 614], [729, 675], [581, 719]])


def main() -> None:
    source = np.asarray(Image.open(SOURCE).convert("RGBA"))
    target = np.asarray(Image.open(TARGET).convert("RGBA")).copy()
    matrix = cv2.getPerspectiveTransform(SOURCE_QUAD, TARGET_QUAD)
    warped = cv2.warpPerspective(
        source,
        matrix,
        (target.shape[1], target.shape[0]),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )

    source_mask = np.zeros(source.shape[:2], dtype=np.uint8)
    cv2.fillConvexPoly(source_mask, SOURCE_QUAD.astype(np.int32), 255)
    warped_mask = cv2.warpPerspective(
        source_mask,
        matrix,
        (target.shape[1], target.shape[0]),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    warped_mask = np.asarray(Image.fromarray(warped_mask).filter(ImageFilter.GaussianBlur(0.45)))
    alpha = (warped_mask.astype(np.float32) / 255.0)[..., None]
    composed = np.clip(
        warped.astype(np.float32) * alpha + target.astype(np.float32) * (1.0 - alpha),
        0,
        255,
    ).astype(np.uint8)
    composed[..., 3] = np.maximum(composed[..., 3], target[..., 3])
    Image.fromarray(composed, "RGBA").save(OUTPUT, optimize=True)
    print(f"repaired {OUTPUT}")


if __name__ == "__main__":
    main()
