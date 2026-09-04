#!/usr/bin/env python3
"""Finalize user-edited batch-04 cutouts by removing disconnected alpha specks."""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parent / "manual_cutout_handoff"


def main() -> None:
    for source in sorted(ROOT.glob("*/auto_body_reference.png")):
        rgba = np.asarray(Image.open(source).convert("RGBA")).copy()
        labels, component_count = ndimage.label(
            rgba[..., 3] > 0,
            structure=np.ones((3, 3), dtype=np.uint8),
        )
        if component_count < 1:
            raise SystemExit(f"empty cutout: {source}")
        sizes = np.bincount(labels.ravel())
        largest = int(np.argmax(sizes[1:]) + 1)
        main = labels == largest
        core = ndimage.binary_erosion(main, iterations=2, border_value=0)
        core_labels, core_count = ndimage.label(
            core,
            structure=np.ones((3, 3), dtype=np.uint8),
        )
        if core_count < 1:
            raise SystemExit(f"empty cutout core: {source}")
        core_sizes = np.bincount(core_labels.ravel())
        largest_core = int(np.argmax(core_sizes[1:]) + 1)
        supported = ndimage.binary_dilation(
            core_labels == largest_core,
            iterations=4,
        )
        removed = (rgba[..., 3] > 0) & ~supported
        rgba[removed] = (0, 0, 0, 0)
        rgba[rgba[..., 3] == 0] = (0, 0, 0, 0)
        output = source.with_name("manual_body.png")
        Image.fromarray(rgba, "RGBA").save(output, optimize=True)
        print(
            f"{source.parent.name}: components={component_count} "
            f"kept={int(sizes[largest])} removed={int(np.count_nonzero(removed))} -> {output}"
        )


if __name__ == "__main__":
    main()
