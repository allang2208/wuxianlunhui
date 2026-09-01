"""Author the isolated sword/shield run candidate from existing pixels.

No model calls, game startup, runtime configuration writes or test execution.
Only this directory's derived parts/previews are written. Edit rig.json first.
"""
from __future__ import annotations

import base64
import io
import json
import math
import re
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
FRAME = (512, 512)
CANVAS = (768, 560)
OFFSET = (128, 12)


def mask_polygon(size, polygon):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon([tuple(p) for p in polygon], fill=255)
    return mask


def cut(image, mask):
    result = image.copy()
    result.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
    # Strip hidden colors without changing visible source pixels.
    blank = Image.new("RGBA", result.size)
    blank.paste(result, mask=result.getchannel("A").point(lambda a: 255 if a else 0))
    return blank


def png_url(image):
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode("ascii")


def turn(point, pivot, root, angle):
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    x, y = point[0] - pivot[0], point[1] - pivot[1]
    return [root[0] + c * x - s * y, root[1] + s * x + c * y]


def place(image, pivot, root, angle, size=CANVAS):
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    # PIL takes inverse output-to-source coordinates; positive angles turn clockwise.
    affine = (c, s, pivot[0] - c * root[0] - s * root[1],
              -s, c, pivot[1] + s * root[0] - c * root[1])
    return image.transform(size, Image.Transform.AFFINE, affine,
                           Image.Resampling.BICUBIC)


def joint_points(rig, pose):
    points = {}
    for side in ("main", "off"):
        upper, fore = rig["parts"][side + "Upper"], rig["parts"][side + "Forearm"]
        shoulder = pose[side + "Shoulder"]
        elbow = turn(upper["end"], upper["pivot"], shoulder, pose[side + "Upper"])
        palm = turn(fore["end"], fore["pivot"], elbow, pose[side + "Forearm"])
        wrist = turn(fore["wrist"], fore["pivot"], elbow, pose[side + "Forearm"])
        points[side] = {"shoulder": shoulder, "elbow": elbow, "wrist": wrist, "palm": palm}
    return points


def shifted(point):
    return [point[0] + OFFSET[0], point[1] + OFFSET[1]]


def render(rig, pose, body, parts, weapon, shield, equipment=True, bones=False):
    result = Image.new("RGBA", CANVAS)
    joints = joint_points(rig, pose)

    def arm(name):
        side = "main" if name.startswith("main") else "off"
        root = joints[side]["shoulder" if name.endswith("Upper") else "elbow"]
        result.alpha_composite(place(parts[name], rig["parts"][name]["localPivot"],
                                     shifted(root), pose[name]))

    arm("offUpper")
    result.alpha_composite(body, OFFSET)
    arm("mainUpper")
    arm("mainForearm")
    if equipment:
        image = weapon["image"].resize(tuple(weapon["sourceSizeRounded"]), Image.Resampling.LANCZOS)
        pivot = [image.width * weapon["grip"][0], image.height * weapon["grip"][1]]
        result.alpha_composite(place(image, pivot, shifted(joints["main"]["palm"]), pose["swordAngle"]))
        # The main palm covers the hilt, with its exact forearm transform.
        result.alpha_composite(place(parts["mainHand"], rig["parts"]["mainHand"]["localPivot"],
                                     shifted(joints["main"]["elbow"]), pose["mainForearm"]))
    arm("offForearm")
    if equipment:
        image = shield["image"].resize(tuple(shield["sourceSizeRounded"]), Image.Resampling.LANCZOS)
        pivot = [image.width * shield["grip"][0], image.height * shield["grip"][1]]
        result.alpha_composite(place(image, pivot, shifted(joints["off"]["palm"]), pose["shieldAngle"]))
    if bones:
        draw = ImageDraw.Draw(result)
        for side, color in [("main", "#edb557"), ("off", "#65c9c4")]:
            chain = [shifted(joints[side][key]) for key in ("shoulder", "elbow", "wrist", "palm")]
            draw.line([tuple(p) for p in chain], fill=color, width=2)
            for x, y in chain:
                draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=color, outline="#161c21")
    return result


def sheet(images):
    output = Image.new("RGBA", (512 * len(images), 512))
    for index, image in enumerate(images):
        output.alpha_composite(image, (index * 512, 0))
    return output


def main():
    rig = json.loads((HERE / "rig.json").read_text(encoding="utf-8"))
    parts_dir, bodies_dir, previews = (HERE / p for p in ("parts", "bodies", "previews"))
    for directory in (parts_dir, bodies_dir, previews):
        directory.mkdir(parents=True, exist_ok=True)
    source = Image.open(ROOT / rig["sources"]["body"]).convert("RGBA")
    idle = Image.open(ROOT / rig["sources"]["arms"]).convert("RGBA")
    originals = [source.crop((index * 512, 0, (index + 1) * 512, 512))
                 for index in rig["sourceFrames"]]
    masks = [mask_polygon(FRAME, polygon) for polygon in rig["bodyMasks"]]
    bodies = [cut(frame, mask) for frame, mask in zip(originals, masks)]
    # Donors are the clean, unpatched same-character frames, not recursively patched images.
    donors = [body.copy() for body in bodies]
    for patch in rig["bodyPatches"]:
        index = patch["frame"]
        mask = mask_polygon(FRAME, patch["polygon"])
        mask = ImageChops.multiply(mask, masks[index])
        donor = Image.new("RGBA", FRAME)
        donor.alpha_composite(donors[patch["donor"]], tuple(patch["offset"]))
        bodies[index].paste(donor, (0, 0), mask)
    for index, body in enumerate(bodies):
        # Exact original lower-leg pixels, independent of all upper-body authoring.
        preserved_y = rig["preserveSourceBelowY"]
        body.paste(originals[index].crop((0, preserved_y, 512, 512)), (0, preserved_y))
        body.save(bodies_dir / f"run-body-{index:02d}.png")
    sheet(bodies).save(HERE / "run-body-sheet.png")
    parts = {}
    for name, data in list(rig["parts"].items()):
        image = cut(idle, mask_polygon(idle.size, data["polygon"]))
        box = image.getbbox()
        image = image.crop(box)
        data["crop"] = list(box)
        data["localPivot"] = [data["pivot"][0] - box[0], data["pivot"][1] - box[1]]
        data["localEnd"] = [data["end"][0] - box[0], data["end"][1] - box[1]]
        data["file"] = f"parts/{name}.png"
        parts[name] = image
        image.save(HERE / data["file"])
        if "handPolygon" in data:
            hand_name = name.replace("Forearm", "Hand")
            hand = cut(idle, mask_polygon(idle.size, data["handPolygon"]))
            hand_box = hand.getbbox()
            hand = hand.crop(hand_box)
            rig["parts"][hand_name] = {
                "file": f"parts/{hand_name}.png", "crop": list(hand_box),
                "localPivot": [data["pivot"][0] - hand_box[0], data["pivot"][1] - hand_box[1]],
                "source": rig["sources"]["arms"],
            }
            parts[hand_name] = hand
            hand.save(HERE / rig["parts"][hand_name]["file"])
    config = json.loads((ROOT / "data/weapon-anim-config.json").read_text(encoding="utf-8"))["sword"]
    eq = rig["equipment"]
    # Read the value in code, not its outdated nearby size comment.
    transform_source = (ROOT / "src/combat/weapon-transform.js").read_text(encoding="utf-8")
    eq["meleeScale"] = float(re.search(r"const MELEE_SCALE = ([0-9.]+);", transform_source).group(1))
    source_scale = 512 / eq["playerDisplaySize"]
    height = eq["weaponBaseSize"] * eq["meleeScale"] * eq["swordScale"]
    weapons = []
    for item in eq["swords"]:
        weapon = dict(item)
        weapon["image"] = Image.open(ROOT / item["path"]).convert("RGBA")
        grip = config["textureGrips"][item["key"]]
        weapon["grip"] = [grip["x"], grip["y"]]
        weapon["displaySize"] = [height * eq["swordWidthRatio"], height]
        weapon["sourceSize"] = [v * source_scale for v in weapon["displaySize"]]
        weapon["sourceSizeRounded"] = [round(v) for v in weapon["sourceSize"]]
        weapons.append(weapon)
    shield_image = Image.open(ROOT / rig["sources"]["shield"]).convert("RGBA")
    shield_height = eq["playerDisplaySize"] * eq["shieldBodyHeightRatio"] / eq["shieldVisibleHeightRatio"]
    shield = {"image": shield_image, "grip": eq["shieldOrigin"],
              "displaySize": [shield_height * shield_image.width / shield_image.height, shield_height]}
    shield["sourceSize"] = [v * source_scale for v in shield["displaySize"]]
    shield["sourceSizeRounded"] = [round(v) for v in shield["sourceSize"]]
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)
    overview = Image.new("RGB", (720, 640), (29, 34, 40))
    draw = ImageDraw.Draw(overview)
    for index, (name, label) in enumerate([
        ("mainUpper", "主手 · 上臂"), ("mainForearm", "主手 · 前臂含掌"), ("mainHand", "主手 · 掌部遮挡层"),
        ("offUpper", "副手 · 上臂"), ("offForearm", "副手 · 前臂含掌"), ("offHand", "副手 · 掌部遮挡层"),
    ]):
        x, y = index % 3 * 240, index // 3 * 320
        picture = parts[name].resize((parts[name].width * 2, parts[name].height * 2), Image.Resampling.NEAREST)
        px, py = x + (240 - picture.width) // 2, y + 56
        overview.paste(picture, (px, py), picture)
        draw.text((x + 12, y + 12), label, font=font, fill="#d5bd86")
        draw.text((x + 12, y + 290), name + ".png / 2×", font=font, fill="#aeb9c3")
        if not name.endswith("Hand"):
            pivot = rig["parts"][name]["localPivot"]
            cx, cy = px + pivot[0] * 2, py + pivot[1] * 2
            draw.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), fill="#65c9c4")
    overview.save(previews / "parts-overview.png")
    rendered = {}
    for weapon in weapons:
        frames = [render(rig, pose, body, parts, weapon, shield)
                  for pose, body in zip(rig["poses"], bodies)]
        rendered[weapon["id"]] = frames
        paired = []
        for frame in frames:
            board = Image.new("RGB", (768, 306), (29, 34, 40))
            for index, picture in enumerate([frame, frame.transpose(Image.Transpose.FLIP_LEFT_RIGHT)]):
                thumb = picture.resize((384, 280), Image.Resampling.LANCZOS)
                board.paste(thumb, (index * 384, 26), thumb)
            draw = ImageDraw.Draw(board)
            draw.text((12, 4), weapon["name"] + " / 原速10FPS / 候选", font=font, fill="#d5bd86")
            paired.append(board)
        paired[0].save(previews / f"{weapon['id']}-both-directions.gif", save_all=True,
                       append_images=paired[1:], duration=100, loop=0, disposal=2)
    all_frames = []
    for frame_index in range(8):
        board = Image.new("RGB", (1536, 612), (29, 34, 40))
        draw = ImageDraw.Draw(board)
        for column, weapon in enumerate(weapons):
            picture = rendered[weapon["id"]][frame_index]
            for row in range(2):
                thumb = (picture if row == 0 else picture.transpose(Image.Transpose.FLIP_LEFT_RIGHT)).resize((384, 280), Image.Resampling.LANCZOS)
                board.paste(thumb, (column * 384, row * 306 + 26), thumb)
                draw.text((column * 384 + 8, row * 306 + 4), weapon["name"] + (" →" if row == 0 else " ←"), font=font, fill="#d5bd86")
        all_frames.append(board)
    all_frames[0].save(previews / "four-swords-both-directions.gif", save_all=True,
                       append_images=all_frames[1:], duration=100, loop=0, disposal=2)
    all_frames[0].save(previews / "four-swords-contact.png")
    cycle = Image.new("RGB", (1536, 612), (29, 34, 40))
    draw = ImageDraw.Draw(cycle)
    for index, frame in enumerate(rendered["knights"]):
        x, y = index % 4 * 384, index // 4 * 306
        thumb = frame.resize((384, 280), Image.Resampling.LANCZOS)
        cycle.paste(thumb, (x, y + 26), thumb)
        draw.text((x + 8, y + 4), f"源帧 {index} / 100ms", font=font, fill="#d5bd86")
    cycle.save(previews / "knights-cycle-contact.png")
    diagnostic = Image.new("RGB", (1536, 1120), (29, 34, 40))
    for index, (body, pose) in enumerate(zip(bodies, rig["poses"])):
        frame = render(rig, pose, body, parts, weapons[1], shield, False, True)
        frame = frame.resize((384, 280), Image.Resampling.LANCZOS)
        diagnostic.paste(frame, ((index % 4) * 384, (index // 4) * 560), frame)
        original = originals[index].resize((256, 256), Image.Resampling.NEAREST)
        diagnostic.paste(original, ((index % 4) * 384 + 64, (index // 4) * 560 + 280), original)
    diagnostic.save(previews / "joint-authoring-contact.png")
    # Explicit source coordinates remain editable in rig.json; derived export is portable.
    rig["jointFrames"] = [joint_points(rig, pose) for pose in rig["poses"]]
    rig["renderOrder"] = ["offUpper", "body", "mainUpper", "mainForearm", "sword", "mainHand", "offForearm", "shield"]
    rig["bodyFiles"] = [f"bodies/run-body-{i:02d}.png" for i in range(8)]
    rig["resolvedWeapons"] = [{k: v for k, v in item.items() if k != "image"} for item in weapons]
    rig["resolvedShield"] = {k: v for k, v in shield.items() if k != "image"}
    (HERE / "rig-export.json").write_text(json.dumps(rig, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    payload = {"rig": rig, "images": {name: png_url(image) for name, image in parts.items()},
               "bodies": [png_url(body) for body in bodies],
               "weapons": [dict(item, image=png_url(item["image"])) for item in weapons],
               "shield": dict(shield, image=png_url(shield["image"]))}
    (HERE / "preview-data.js").write_text("window.RUN_CANDIDATE = " + json.dumps(payload, ensure_ascii=False) + ";\n", encoding="utf-8")
    print("Created 8 body frames, 6 reusable arm/hand cutouts, joint export and four sword loop previews.")
    print("Runtime assets/configuration were not written. Interactive preview is authored separately.")


if __name__ == "__main__":
    main()
