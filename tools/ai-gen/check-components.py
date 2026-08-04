#!/usr/bin/env python3
"""Count separated alpha components to detect multi-view / multi-item images."""

import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)

import importlib.util
_spec = importlib.util.spec_from_file_location("bc", os.path.join(TOOLS, "birefnet-cutout.py"))
bc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bc)

RAW = os.path.join(TOOLS, "eclipse-raw")
FILE = os.environ.get("COMP_FILE", "eclipse_helmet.png")


def main():
    model = bc.load_model()
    src = os.path.join(RAW, FILE)
    tmp = os.path.join(TOOLS, "check-previews", "comp_helmet.png")
    rgba = bc.cutout(model, src, tmp)
    alpha = (np.asarray(rgba)[..., 3] > 60)
    labels, n = ndimage.label(alpha)
    sizes = ndimage.sum(alpha, labels, range(1, n + 1))
    order = np.argsort(sizes)[::-1]
    print("components:", n)
    for i in order[:6]:
        print(f"  comp {i+1}: {sizes[i]:.0f} px ({sizes[i]/sizes.sum()*100:.1f}%)")


if __name__ == "__main__":
    main()
