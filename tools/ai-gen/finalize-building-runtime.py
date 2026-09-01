#!/usr/bin/env python3
"""Create a tightly-cropped, aspect-safe RGBA runtime building texture.

The important contract is that Phaser scales the complete texture canvas.  The
runtime display height must therefore be derived from the final cropped canvas,
not from an alpha bounding box still sitting inside a square source image.
"""

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def alpha_from_flat_background(rgb):
    height, width = rgb.shape[:2]
    margin = max(4, min(12, min(width, height) // 32))
    border = np.concatenate([
        rgb[:margin].reshape(-1, 3),
        rgb[-margin:].reshape(-1, 3),
        rgb[:, :margin].reshape(-1, 3),
        rgb[:, -margin:].reshape(-1, 3),
    ])
    background = np.median(border, axis=0)
    distance = np.linalg.norm(rgb - background, axis=2)

    # Flat-color renders often contain a soft cast shadow.  Its darker yellow
    # pixels can pass the foreground threshold and remain connected to the
    # foundation.  Flood the background inward through a wider color-distance
    # band so those border-connected shadow gradients are rejected without
    # erasing enclosed warm details such as lamps, sacks or straw.
    background_seed = np.zeros((height, width), dtype=bool)
    background_seed[0, :] = True
    background_seed[-1, :] = True
    background_seed[:, 0] = True
    background_seed[:, -1] = True
    background_reachable = ndimage.binary_propagation(
        background_seed,
        mask=distance < 150.0,
    )

    labels, count = ndimage.label(distance > 82.0)
    if count == 0:
        raise SystemExit("no foreground component found")
    sizes = ndimage.sum(labels > 0, labels, range(1, count + 1))
    subject = (labels == (1 + int(np.argmax(sizes)))) & ~background_reachable
    subject = ndimage.binary_closing(subject, iterations=2)
    # Do not fill enclosed background-color gaps.  Courtyards, open doors and
    # concave foundation corners can surround keyed background pixels; filling
    # them turns the original yellow backdrop into opaque wedges.
    subject = ndimage.binary_erosion(subject, iterations=1)

    core = ndimage.binary_erosion(subject, iterations=1)
    support = ndimage.binary_dilation(subject, iterations=2)
    soft = np.clip((distance - 48.0) / 46.0, 0.0, 1.0)
    alpha = np.where(core, 1.0, np.where(support, soft, 0.0))
    alpha = ndimage.gaussian_filter(alpha, sigma=0.55)
    alpha[alpha < 0.02] = 0.0

    # Remove the yellow/flat-color matte from antialiased boundary pixels.
    _, nearest = ndimage.distance_transform_edt(~core, return_indices=True)
    edge = (alpha > 0.0) & (alpha < 0.985)
    rgb[edge] = rgb[nearest[0][edge], nearest[1][edge]]
    return alpha, background


def parse_hex_color(value):
    raw = value.strip().lstrip("#")
    if len(raw) != 6:
        raise argparse.ArgumentTypeError("matte color must be #RRGGBB")
    try:
        return np.asarray([int(raw[index:index + 2], 16) for index in (0, 2, 4)], dtype=np.float32)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("matte color must be #RRGGBB") from exc


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("src")
    parser.add_argument("dst")
    parser.add_argument("--display-width", type=int, required=True)
    parser.add_argument("--padding", type=int, default=4)
    parser.add_argument("--desaturate", type=float, default=0.0)
    parser.add_argument("--matte-color", type=parse_hex_color,
                        help="Remove a known flat-background color from existing RGBA antialiasing without changing alpha")
    parser.add_argument("--matte-edge-width", type=float, default=0.0,
                        help="Also repair opaque matte-colored pixels this many source pixels inside the alpha edge")
    parser.add_argument("--matte-tolerance", type=float, default=110.0,
                        help="RGB distance from --matte-color treated as contamination in the edge band")
    parser.add_argument("--nearest-opaque-edge-rgb", action="store_true",
                        help="Preserve alpha but replace every semi-transparent edge RGB pixel with the nearest opaque subject color")
    parser.add_argument("--nearest-opaque-alpha", type=float, default=0.98,
                        help="Minimum normalized alpha used as a reliable RGB source for --nearest-opaque-edge-rgb")
    parser.add_argument("--defringe-inner-pixels", type=int, default=0,
                        help="Preserve alpha but replace this many opaque boundary pixels with nearest interior RGB")
    parser.add_argument("--min-component-pixels", type=int, default=0,
                        help="Remove isolated alpha components smaller than this many source pixels")
    parser.add_argument("--preserve-alpha-exact", action="store_true",
                        help="For an accepted RGBA source, keep every alpha byte unchanged while repairing RGB and cropping")
    parser.add_argument("--mask-image", help="Depth/control render used to reject generated shadows outside the modeled silhouette")
    parser.add_argument("--mask-dilate", type=int, default=10,
                        help="Positive expands the model mask; negative contracts it to remove generated matte fringes")
    parser.add_argument("--fill-alpha-holes", action="store_true",
                        help="Restore enclosed dark/bright details lost by flat-background keying (for example lit windows)")
    parser.add_argument("--fill-hole-matte-distance", type=float, default=24.0,
                        help="Keep enclosed pixels transparent when their mean RGB remains this close to the extracted matte")
    parser.add_argument("--remove-enclosed-matte", action="store_true",
                        help="Remove enclosed pixels whose chromaticity still matches the extracted flat backdrop")
    parser.add_argument("--enclosed-matte-chroma-distance", type=float, default=0.06,
                        help="Maximum normalized RGB chromaticity distance used by --remove-enclosed-matte")
    parser.add_argument("--mask-add-rect", action="append", default=[], metavar="X0,Y0,X1,Y1",
                        help="Keep an additional generated detail region that intentionally exceeds the model mask")
    parser.add_argument("--restore-alpha-rect", action="append", default=[], metavar="X0,Y0,X1,Y1",
                        help="Restore source opacity in a tightly bounded detail lost during flat-background extraction")
    parser.add_argument("--remove-matte-rect", action="append", default=[], metavar="X0,Y0,X1,Y1",
                        help="Within a bounded source rect, clear alpha where RGB remains close to --matte-color")
    parser.add_argument("--clear-matte-outside-polygon", action="append", default=[],
                        metavar="X0,Y0;X1,Y1;...",
                        help="Clear matte-colored pixels outside an authored keep polygon; requires --matte-color")
    parser.add_argument("--clear-green-rect", action="append", default=[], metavar="X0,Y0,X1,Y1",
                        help="Within a bounded source rect, clear saturated HSV-green backdrop pixels")
    parser.add_argument("--clear-alpha-rect", action="append", default=[], metavar="X0,Y0,X1,Y1",
                        help="Clear alpha inside a tightly bounded source rect known to contain only backdrop residue")
    parser.add_argument("--clear-alpha-polygon", action="append", default=[], metavar="X0,Y0;X1,Y1;...",
                        help="Clear alpha inside a tightly bounded source polygon known to contain only backdrop residue")
    parser.add_argument("--green-hue-min", type=float, default=35.0,
                        help="Minimum OpenCV-style HSV hue for --clear-green-rect")
    parser.add_argument("--green-hue-max", type=float, default=75.0,
                        help="Maximum OpenCV-style HSV hue for --clear-green-rect")
    parser.add_argument("--green-saturation-min", type=int, default=80,
                        help="Minimum HSV saturation for --clear-green-rect")
    parser.add_argument("--green-value-min", type=int, default=20,
                        help="Minimum HSV value for --clear-green-rect")
    parser.add_argument("--metadata")
    args = parser.parse_args()

    source = Image.open(args.src)
    rgba = np.asarray(source.convert("RGBA"), dtype=np.uint8).copy()
    rgb = rgba[..., :3].astype(np.float32)
    source_alpha = rgba[..., 3].astype(np.float32) / 255.0
    has_real_alpha = source.mode in ("RGBA", "LA") and np.any(rgba[..., 3] < 250)
    background = None
    if has_real_alpha:
        alpha = source_alpha
        if args.matte_color is not None:
            a = alpha[..., None]
            foreground = (rgb - (1.0 - a) * args.matte_color) / np.maximum(a, 1e-3)
            edge = (alpha > 0.0) & (alpha < 0.999)
            rgb[edge] = foreground[edge]
            if args.matte_edge_width > 0:
                opaque = alpha > 0.02
                inside_distance = ndimage.distance_transform_edt(opaque)
                matte_distance = np.linalg.norm(rgb - args.matte_color, axis=2)
                contaminated = (opaque
                                & (inside_distance <= float(args.matte_edge_width))
                                & (matte_distance < float(args.matte_tolerance)))
                reliable = opaque & ~contaminated & (alpha > 0.5)
                if np.any(contaminated) and np.any(reliable):
                    _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
                    rgb[contaminated] = rgb[nearest[0][contaminated], nearest[1][contaminated]]
    else:
        alpha, background = alpha_from_flat_background(rgb)

    if args.remove_enclosed_matte:
        if background is None:
            raise SystemExit("--remove-enclosed-matte requires a flat RGB source with an extracted background")
        background_chroma = background / max(float(np.sum(background)), 1.0)
        rgb_sum = np.maximum(np.sum(rgb, axis=2, keepdims=True), 1.0)
        rgb_chroma = rgb / rgb_sum
        chroma_distance = np.linalg.norm(rgb_chroma - background_chroma, axis=2)
        # Flat yellow backdrops can remain trapped inside tower frames or other
        # enclosed openings after the edge flood.  Compare chromaticity rather
        # than absolute RGB distance so the same backdrop under a cast shadow
        # is removed without erasing warmer orange lamps or brown materials.
        enclosed_matte = (np.max(rgb, axis=2) > 32.0) & (
            chroma_distance <= float(args.enclosed_matte_chroma_distance)
        )
        alpha[enclosed_matte] = 0.0

    if args.mask_image:
        mask_image = Image.open(args.mask_image).convert("L")
        if mask_image.size != source.size:
            mask_image = mask_image.resize(source.size, Image.Resampling.BILINEAR)
        modeled = np.asarray(mask_image, dtype=np.uint8) > 3
        modeled = ndimage.binary_fill_holes(modeled)
        for raw_rect in args.mask_add_rect:
            x0, y0, x1, y1 = (int(value) for value in raw_rect.split(","))
            x0, x1 = sorted((max(0, x0), min(source.width, x1)))
            y0, y1 = sorted((max(0, y0), min(source.height, y1)))
            modeled[y0:y1, x0:x1] = True
        mask_adjust = int(args.mask_dilate)
        if mask_adjust > 0:
            modeled = ndimage.binary_dilation(modeled, iterations=mask_adjust)
        elif mask_adjust < 0:
            modeled = ndimage.binary_erosion(modeled, iterations=-mask_adjust)
        modeled_soft = ndimage.gaussian_filter(modeled.astype(np.float32), sigma=0.7)
        if args.fill_alpha_holes:
            subject_opaque = alpha > 0.02
            filled_subject = ndimage.binary_fill_holes(subject_opaque)
            if background is not None:
                holes = filled_subject & ~subject_opaque
                labels, count = ndimage.label(holes)
                matte_distance = np.linalg.norm(rgb - background, axis=2)
                fillable = np.zeros_like(holes)
                for label_id in range(1, count + 1):
                    component = labels == label_id
                    if float(np.mean(matte_distance[component])) >= float(args.fill_hole_matte_distance):
                        fillable[component] = True
                filled_subject = subject_opaque | fillable
            filled_soft = ndimage.gaussian_filter(filled_subject.astype(np.float32), sigma=0.55)
            alpha = np.maximum(alpha, filled_soft)
        alpha *= np.clip(modeled_soft, 0.0, 1.0)

    for raw_rect in args.restore_alpha_rect:
        x0, y0, x1, y1 = (int(value) for value in raw_rect.split(","))
        x0, x1 = sorted((max(0, x0), min(source.width, x1)))
        y0, y1 = sorted((max(0, y0), min(source.height, y1)))
        alpha[y0:y1, x0:x1] = source_alpha[y0:y1, x0:x1]

    if args.remove_matte_rect:
        if args.matte_color is None:
            raise SystemExit("--remove-matte-rect requires --matte-color")
        matte_distance = np.linalg.norm(rgb - args.matte_color, axis=2)
        for raw_rect in args.remove_matte_rect:
            x0, y0, x1, y1 = (int(value) for value in raw_rect.split(","))
            x0, x1 = sorted((max(0, x0), min(source.width, x1)))
            y0, y1 = sorted((max(0, y0), min(source.height, y1)))
            local_alpha = alpha[y0:y1, x0:x1]
            local_alpha[matte_distance[y0:y1, x0:x1] < float(args.matte_tolerance)] = 0.0

    if args.clear_matte_outside_polygon:
        if args.matte_color is None:
            raise SystemExit("--clear-matte-outside-polygon requires --matte-color")
        matte_distance = np.linalg.norm(rgb - args.matte_color, axis=2)
        for raw_polygon in args.clear_matte_outside_polygon:
            points = []
            for raw_point in raw_polygon.split(";"):
                x, y = (int(value) for value in raw_point.split(","))
                points.append((max(0, min(source.width - 1, x)),
                               max(0, min(source.height - 1, y))))
            if len(points) < 3:
                raise SystemExit("--clear-matte-outside-polygon needs at least three points")
            polygon = Image.new("L", source.size, 0)
            ImageDraw.Draw(polygon).polygon(points, fill=255)
            keep = np.asarray(polygon, dtype=np.uint8) > 0
            alpha[(~keep) & (matte_distance < float(args.matte_tolerance))] = 0.0

    if args.clear_green_rect:
        hsv = np.asarray(Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").convert("HSV"))
        hue = hsv[..., 0].astype(np.float32) * (179.0 / 255.0)
        green = ((hue >= float(args.green_hue_min))
                 & (hue <= float(args.green_hue_max))
                 & (hsv[..., 1] >= int(args.green_saturation_min))
                 & (hsv[..., 2] >= int(args.green_value_min)))
        for raw_rect in args.clear_green_rect:
            x0, y0, x1, y1 = (int(value) for value in raw_rect.split(","))
            x0, x1 = sorted((max(0, x0), min(source.width, x1)))
            y0, y1 = sorted((max(0, y0), min(source.height, y1)))
            local_alpha = alpha[y0:y1, x0:x1]
            local_alpha[green[y0:y1, x0:x1]] = 0.0

    for raw_rect in args.clear_alpha_rect:
        x0, y0, x1, y1 = (int(value) for value in raw_rect.split(","))
        x0, x1 = sorted((max(0, x0), min(source.width, x1)))
        y0, y1 = sorted((max(0, y0), min(source.height, y1)))
        alpha[y0:y1, x0:x1] = 0.0

    for raw_polygon in args.clear_alpha_polygon:
        points = []
        for raw_point in raw_polygon.split(";"):
            x, y = (int(value) for value in raw_point.split(","))
            points.append((max(0, min(source.width - 1, x)),
                           max(0, min(source.height - 1, y))))
        if len(points) < 3:
            raise SystemExit("--clear-alpha-polygon needs at least three points")
        polygon = Image.new("L", source.size, 0)
        ImageDraw.Draw(polygon).polygon(points, fill=255)
        alpha[np.asarray(polygon, dtype=np.uint8) > 0] = 0.0

    # Flat-color RGB generations can contain a fully opaque one-pixel matte
    # rim that survives the soft alpha estimate.  Repair only the outer alpha
    # edge after optional hole filling so warm window interiors stay intact.
    extracted_matte = background if background is not None else None
    if extracted_matte is not None and args.matte_edge_width > 0:
        opaque = alpha > 0.02
        inside_distance = ndimage.distance_transform_edt(opaque)
        matte_distance = np.linalg.norm(rgb - extracted_matte, axis=2)
        contaminated = (opaque
                        & (inside_distance <= float(args.matte_edge_width))
                        & (matte_distance < float(args.matte_tolerance)))
        reliable = opaque & ~contaminated & (alpha > 0.5)
        if np.any(contaminated) and np.any(reliable):
            _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
            rgb[contaminated] = rgb[nearest[0][contaminated], nearest[1][contaminated]]

    if args.nearest_opaque_edge_rgb:
        source_alpha_threshold = float(np.clip(args.nearest_opaque_alpha, 0.01, 1.0))
        edge = (alpha > 0.0) & (alpha < 0.999)
        reliable = alpha >= source_alpha_threshold
        if np.any(edge) and np.any(reliable):
            _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
            rgb[edge] = rgb[nearest[0][edge], nearest[1][edge]]

    defringe_inner_pixels = max(0, int(args.defringe_inner_pixels))
    if defringe_inner_pixels > 0:
        opaque = alpha > 0.02
        interior = ndimage.binary_erosion(opaque, iterations=defringe_inner_pixels)
        boundary = opaque & ~interior
        reliable = interior & (alpha >= float(np.clip(args.nearest_opaque_alpha, 0.01, 1.0)))
        if np.any(boundary) and np.any(reliable):
            _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
            rgb[boundary] = rgb[nearest[0][boundary], nearest[1][boundary]]

    if args.desaturate:
        amount = float(np.clip(args.desaturate, 0.0, 1.0))
        luminance = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
        rgb = luminance[..., None] + (rgb - luminance[..., None]) * (1.0 - amount)

    if args.preserve_alpha_exact:
        if not has_real_alpha:
            raise SystemExit("--preserve-alpha-exact requires an RGBA/LA source with real transparency")
        alpha_u8 = rgba[..., 3].copy()
    else:
        alpha_u8 = np.clip(alpha * 255, 0, 255).astype(np.uint8)
        # Discard sub-visible matte specks left by the soft edge blur.  Values at
        # this level do not contribute useful antialiasing at game scale.
        alpha_u8[alpha_u8 < 8] = 0
    min_component_pixels = max(0, int(args.min_component_pixels))
    removed_components = 0
    removed_component_pixels = 0
    if min_component_pixels > 1:
        labels, component_count = ndimage.label(
            alpha_u8 > 0, structure=np.ones((3, 3), dtype=np.uint8))
        if component_count > 0:
            sizes = np.bincount(labels.ravel())
            small_labels = np.where(
                (sizes < min_component_pixels) & (np.arange(len(sizes)) > 0))[0]
            if len(small_labels):
                remove_mask = np.isin(labels, small_labels)
                removed_components = int(len(small_labels))
                removed_component_pixels = int(np.count_nonzero(remove_mask))
                alpha_u8[remove_mask] = 0
    ys, xs = np.where(alpha_u8 > 0)
    if not len(xs):
        raise SystemExit("empty alpha after extraction")
    pad = max(0, int(args.padding))
    x0 = max(0, int(xs.min()) - pad)
    y0 = max(0, int(ys.min()) - pad)
    x1 = min(alpha_u8.shape[1], int(xs.max()) + 1 + pad)
    y1 = min(alpha_u8.shape[0], int(ys.max()) + 1 + pad)

    rgb_u8 = np.clip(rgb, 0, 255).astype(np.uint8)
    rgb_u8[alpha_u8 == 0] = 0
    output = np.dstack([rgb_u8, alpha_u8])[y0:y1, x0:x1]
    destination = Path(args.dst)
    destination.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(output, "RGBA").save(destination, optimize=True)

    final_h, final_w = output.shape[:2]
    display_w = int(args.display_width)
    scale = display_w / final_w
    display_h = round(final_h * scale)
    local_alpha = output[..., 3]
    local_ys, local_xs = np.where(local_alpha > 0)
    alpha_bottom = int(local_ys.max())
    foot_offset = round(((alpha_bottom + 1) - final_h / 2.0) * scale)
    metadata = {
        "source": str(Path(args.src)),
        "output": str(destination),
        "sourceMode": source.mode,
        "background": background.astype(int).tolist() if background is not None else None,
        "matteColor": args.matte_color.astype(int).tolist() if args.matte_color is not None else None,
        "matteEdgeWidth": float(args.matte_edge_width) if (args.matte_color is not None or background is not None) else None,
        "matteTolerance": float(args.matte_tolerance) if (args.matte_color is not None or background is not None) else None,
        "nearestOpaqueEdgeRgb": bool(args.nearest_opaque_edge_rgb),
        "nearestOpaqueAlpha": float(args.nearest_opaque_alpha) if args.nearest_opaque_edge_rgb else None,
        "defringeInnerPixels": defringe_inner_pixels,
        "minComponentPixels": min_component_pixels,
        "removedComponents": removed_components,
        "removedComponentPixels": removed_component_pixels,
        "preserveAlphaExact": bool(args.preserve_alpha_exact),
        "maskImage": str(Path(args.mask_image)) if args.mask_image else None,
        "maskDilate": int(args.mask_dilate) if args.mask_image else None,
        "fillAlphaHoles": bool(args.fill_alpha_holes),
        "fillHoleMatteDistance": float(args.fill_hole_matte_distance) if args.fill_alpha_holes else None,
        "removeEnclosedMatte": bool(args.remove_enclosed_matte),
        "enclosedMatteChromaDistance": float(args.enclosed_matte_chroma_distance) if args.remove_enclosed_matte else None,
        "maskAddRects": args.mask_add_rect if args.mask_image else [],
        "restoreAlphaRects": args.restore_alpha_rect,
        "removeMatteRects": args.remove_matte_rect,
        "clearMatteOutsidePolygons": args.clear_matte_outside_polygon,
        "clearGreenRects": args.clear_green_rect,
        "clearAlphaRects": args.clear_alpha_rect,
        "clearAlphaPolygons": args.clear_alpha_polygon,
        "greenHueRange": [float(args.green_hue_min), float(args.green_hue_max)] if args.clear_green_rect else None,
        "greenSaturationMin": int(args.green_saturation_min) if args.clear_green_rect else None,
        "greenValueMin": int(args.green_value_min) if args.clear_green_rect else None,
        "cropBox": [x0, y0, x1, y1],
        "fileSize": [final_w, final_h],
        "alphaBBox": [int(local_xs.min()), int(local_ys.min()),
                      int(local_xs.max()) + 1, int(local_ys.max()) + 1],
        "displayW": display_w,
        "displayH": display_h,
        "footOffsetY": foot_offset,
        "scaleX": scale,
        "scaleY": display_h / final_h,
    }
    if args.metadata:
        Path(args.metadata).write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        repo_root = Path(__file__).resolve().parents[2]
        destination = Path(args.dst).resolve()
        formal_terrain_root = (repo_root / "assets" / "terrain").resolve()
        # 候选图、中间清理和非建筑素材即使写 metadata，也不能改写阴影清单。
        # 只有正式 terrain 根目录中的已登记建筑贴图才触发目标级条目刷新。
        if destination.parent == formal_terrain_root:
            subprocess.run(
                [
                    "node",
                    str(repo_root / "tools" / "generate-building-shadow-casters.mjs"),
                    "--write",
                    "--write-if-source",
                    str(destination),
                ],
                cwd=repo_root,
                check=True,
            )
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
