"""User-directed v02: two-storey oil plant and distinctive canning works.

The original models, source and trading-company candidate remain untouched.
"""
import importlib.util
import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent
base_spec = importlib.util.spec_from_file_location("industrial_economy_v01", OUT.parent / "build-models.py")
base = importlib.util.module_from_spec(base_spec)
base_spec.loader.exec_module(base)
Model, kit, bpy, pack, Vector = base.Model, base.kit, base.bpy, base.pack, base.Vector


def ring(m, name, center, radius, thickness=3, mat="iron", rotation=(0, 0, 0)):
    return kit.torus_ring(m.c, m.root, m.n(name), radius, thickness, center,
                         m.m[mat], rotation=rotation, major_segments=48, minor_segments=10)


def extruded_badge(m, name, center, profile, mat, thickness=7):
    x, y, z = center
    count = len(profile)
    vertices = [(x + px, y + dy, z + pz) for dy in (0, -thickness) for px, pz in profile]
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, 2 * count))]
    faces += [(i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count)]
    return m.mesh(name, vertices, faces, mat)


def can(m, name, center, radius=19, height=44, label=True):
    x, y, z = center
    m.cyl(name + "_Body", radius, height, center, "steel")
    for side in (-1, 1):
        ring(m, name + f"_RolledRim_{side}", (x, y, z + side * height / 2), radius, 2, "steel")
    if label:
        m.cyl(name + "_Label", radius + .6, height * .46, center, "label_red")


def build_oil_power_plant(spec):
    m = Model("oil_power_plant", spec)
    d, g = m.d, m.ground
    cx, cy = d["hallCenter"]
    bw, bd = d["hallBody"]
    first, second = d["floors"]
    shell = m.shell("EngineFloor1", (bw, bd, first), (cx, cy, g), d["door"])
    front, left = shell["front"], shell["left"]
    upper = bpy.data.objects.new(m.n("ControlFloor2_AlignedRoot"), None)
    m.c.objects.link(upper)
    upper.parent = m.root
    upper.location = (cx, cy, g + first)
    kit.stacked_bearing_shells(m.c, upper, m.n("ControlFloor2"),
                             [(bw, bd, second)], m.m["brick"])
    top = g + first + second
    m.root["main_storeys"] = 2
    m.root["chimney_count"] = 1
    m.root["chimney_real_open_bore"] = True
    for label, z in (("FloorSeparation", g + first), ("Cornice", top)):
        m.box(label + "Front", (bw + 26, 25, 19), (cx, front - 5, z), "stone")
        m.box(label + "Side", (25, bd + 26, 19), (left - 5, cy, z), "stone")
    for index, x in enumerate((cx - 161, cx + 161)):
        m.window(f"EngineFloor1_FrontWindow{index}", (x, front - 15, g + 102), 71, 96)
    for index, x in enumerate((cx - 145, cx, cx + 145)):
        m.window(f"ControlFloor2_FrontWindow{index}", (x, front - 15, g + first + 84), 96, 106, columns=3)
    for level, base_z, height in ((1, g, first), (2, g + first, second)):
        for index, y in enumerate((cy - 165, cy, cy + 165)):
            m.window(f"Floor{level}_SideWindow{index}", (left - 15, y, base_z + height * .54),
                     92, 88 if level == 1 else 104, side=True)
    for side in (-1, 1):
        m.box(f"FrontBearingPier_{side}", (23, 28, first + second),
              (cx + side * (bw / 2 - 5), front - 4, g + (first + second) / 2), "stone")
    kit.gabled_prism(m.c, m.root, m.n("EngineHall_Roof"), bw + 26, bd + 26,
                    d["roofRise"], (cx, cy, top + 8), m.m["brick"], m.m["roof"])
    m.box("EntryThreshold", (172, 70, 8), (cx, front - 28, g + 4), "stone")

    # A separate tall stack with a full-depth bore, connected to the engine hall.
    sx, sy = d["chimneyCenter"]
    stack_h, rb, rt, wall = (d[key] for key in
                            ("chimneyHeight", "chimneyBottomRadius", "chimneyTopRadius", "chimneyWall"))
    m.box("Smokestack_Foundation", (174, 174, 20), (sx, sy, g + 10), "stone", bevel=5)
    kit.open_tapered_tube(m.c, m.root, m.n("Smokestack_OpenShaft"), (sx, sy, g + 14),
                         stack_h, rb, rt, wall, m.m["brick"], m.m["interior"])
    mouth_z = g + 14 + stack_h
    kit.open_tapered_tube(m.c, m.root, m.n("Smokestack_OpenCrown"), (sx, sy, mouth_z - 20),
                         26, rt + 7, rt + 7, wall + 7, m.m["stone"], m.m["interior"])
    for index, fraction in enumerate((.18, .47, .76)):
        radius = rb + (rt - rb) * fraction
        ring(m, f"Smokestack_Band{index}", (sx, sy, g + 14 + stack_h * fraction), radius + .5, 4)
    # The inlet passes through a true side opening into the hollow stack.
    inlet_z = g + 139
    stack = bpy.data.objects[m.n("Smokestack_OpenShaft")]
    cutter = m.cyl("Smokestack_FlueCutout", 30, 125, (sx + rb - 8, sy, inlet_z), "iron", (0, 90, 0))
    bpy.context.view_layer.objects.active = stack
    cut = stack.modifiers.new("Physical_Flue_Inlet", "BOOLEAN")
    cut.operation = "DIFFERENCE"
    cut.object = cutter
    bpy.ops.object.modifier_apply(modifier=cut.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    flue = kit.open_tapered_tube(m.c, m.root, m.n("EngineToStack_HollowFlue"),
        (sx + 30, sy, inlet_z), left - sx - 20, 29, 29, 5, m.m["iron"], m.m["interior"])
    flue.rotation_euler.y = math.pi / 2
    ring(m, "EngineToStack_WallFlange", (left - 9, sy, inlet_z), 34, 5, "steel", (0, 90, 0))
    # Sparse ladder and landings also make the stack's scale legible.
    for side in (-1, 1):
        m.pipe(f"Smokestack_LadderRail_{side}", [(sx + side * 19, sy - rb - 8, g + 36),
            (sx + side * 19, sy - rt - 8, mouth_z - 38)], 3.2)
    for index in range(17):
        fraction = index / 17
        yy = sy - rb - 8 + (rb - rt) * fraction
        m.pipe(f"Smokestack_LadderRung_{index}", [(sx - 19, yy, g + 48 + index * 32),
            (sx + 19, yy, g + 48 + index * 32)], 2.5)

    for index, center in enumerate(d["tankCenters"]):
        x, y, z = center
        m.box(f"FuelTank{index}_Bed", (157, 201, 12), (x, y, g + 6), "stone")
        for side in (-1, 1):
            m.box(f"FuelTank{index}_Saddle_{side}", (119, 22, 39), (x, y + side * 53, g + 31), "iron", bevel=4)
        kit.banded_storage_tank(m.c, m.root, m.n(f"FuelTank{index}"), center,
            d["tankRadius"], d["tankLength"], m.m["accent"], m.m["iron"], axis="Y")
        m.cyl(f"FuelTank{index}_FillNeck", 13, 19, (x, y, z + d["tankRadius"] + 7), "iron")
        m.cyl(f"FuelTank{index}_FillCap", 19, 5, (x, y, z + d["tankRadius"] + 18), "steel")
        m.pipe(f"FuelTank{index}_Feed", [(x + 60, y, z - 24), (left - 31, y, z - 24),
               (left - 31, y, g + 71), (left + 10, y, g + 71)], 8)
        ring(m, f"FuelTank{index}_Valve", (left - 32, y - 8, g + 92), 14, 3, "brass", (90, 0, 0))
    m.box("FuelBadge_Back", (127, 12, 48), (cx, front - 18, g + 172), "iron", bevel=4)
    extruded_badge(m, "FuelBadge_Drop", (cx - 30, front - 27, g + 174),
                  [(-15, -4), (-12, -17), (0, -22), (12, -17), (15, -4), (0, 19)], "accent")
    extruded_badge(m, "FuelBadge_Lightning", (cx + 28, front - 27, g + 174),
                  [(-3, 20), (-18, -3), (-3, -3), (-10, -21), (18, 6), (3, 6), (10, 20)], "brass")
    return m.root


def build_cannery(spec):
    m = Model("cannery", spec)
    d, g = m.d, m.ground
    cx, cy = d["hallCenter"]
    bw, bd, bh = d["hallBody"]
    shell = m.shell("PackingHall", (bw, bd, bh), (cx, cy, g), d["door"], mat="plaster")
    front, left, top = shell["front"], shell["left"], shell["top"]
    m.root["main_storeys"] = 1
    m.root["ingredient_tower_is_process_equipment"] = True
    m.root["visual_identity"] = "cans, produce emblem, exposed sealing line and horizontal retort"
    vault = kit.barrel_vault(m.c, m.root, m.n("CurvedProcessingRoof"), bd + 18, bw + 24,
                            d["roofRise"], (cx, cy, top), m.m["stone"], m.m["roof"], segments=28)
    vault.rotation_euler.z = math.pi / 2
    for index, yy in enumerate((front - 11, cy - 72, cy + 72, cy + bd / 2 + 11)):
        points = [(cx + (bw / 2 + 14) * math.cos(math.pi * i / 18), yy,
                   top + d["roofRise"] * math.sin(math.pi * i / 18) + 3) for i in range(19)]
        m.pipe(f"RoofArchRib{index}", points, 3.4, "iron")
    m.box("FrontBrickSill", (bw + 14, 25, 29), (cx, front - 4, g + 19), "brick")
    m.box("SideBrickSill", (25, bd + 14, 29), (left - 4, cy, g + 19), "brick")
    for side in (-1, 1):
        m.box(f"PackingHall_FrontPier{side}", (26, 28, bh),
              (cx + side * (bw / 2 - 4), front - 5, g + bh / 2), "brick")
        m.window(f"PackingHall_FrontGlazing{side}", (cx + side * 158, front - 15, g + 121), 103, 131, columns=3, rows=3)
    for index, y in enumerate((cy - 138, cy, cy + 138)):
        m.window(f"PackingHall_SideGlazing{index}", (left - 15, y, g + 152), 106, 106, side=True, columns=3)

    # A sealed, can-shaped ingredient tower attached to the left rear wall.
    tx, ty = d["ingredientTowerCenter"]
    tr, th = d["ingredientTowerRadius"], d["ingredientTowerHeight"]
    m.box("IngredientTower_StonePad", (208, 208, 15), (tx, ty, g + 7.5), "stone", bevel=4)
    m.cyl("IngredientTower_Body", tr, th - 28, (tx, ty, g + 18 + (th - 28) / 2), "steel")
    for index, zz in enumerate((g + 24, g + 53, g + th - 25, g + th - 4)):
        ring(m, f"IngredientTower_RolledRim{index}", (tx, ty, zz), tr + 1.5, 5, "steel")
    m.cyl("IngredientTower_Lid", tr + 2, 9, (tx, ty, g + th - 2), "steel")
    m.cyl("IngredientTower_RedLabel", tr + .8, 102, (tx, ty, g + 229), "label_red")
    # A large produce medallion is modeled on the label; no text is needed.
    m.cyl("IngredientTower_ProduceMedallion", 39, 8, (tx, ty - tr - 5, g + 229), "stone", (90, 0, 0))
    m.cyl("IngredientTower_Tomato", 24, 10, (tx, ty - tr - 12, g + 224), "label_red", (90, 0, 0))
    extruded_badge(m, "IngredientTower_ProduceLeaf", (tx, ty - tr - 18, g + 248),
                  [(0, -6), (-20, 5), (-13, 15), (0, 8), (14, 18), (20, 6)], "leaf_green", 4)
    m.pipe("IngredientTower_DosingPipe", [(tx + tr - 4, ty, g + 96), (left + 18, ty, g + 96)], 13, "steel")

    # A large horizontal pressure retort with a locking front door and wheel.
    rx, ry, rz = d["retortCenter"]
    rr, length = d["retortRadius"], d["retortLength"]
    kit.banded_storage_tank(m.c, m.root, m.n("SterilizingRetort"), (rx, ry, rz), rr,
                           length, m.m["steel"], m.m["iron"], axis="Y")
    m.box("SterilizingRetort_Bed", (145, length + 36, 15), (rx, ry, g + 7.5), "stone")
    for side in (-1, 1):
        m.box(f"SterilizingRetort_Saddle{side}", (111, 20, 40), (rx, ry + side * 67, g + 31), "iron")
    hatch_y = ry - length / 2 - rr * .23 - 5
    m.cyl("SterilizingRetort_Hatch", rr - 5, 12, (rx, hatch_y, rz), "steel", (90, 0, 0))
    ring(m, "SterilizingRetort_DoorSeal", (rx, hatch_y - 7, rz), rr - 8, 4, "iron", (90, 0, 0))
    ring(m, "SterilizingRetort_LockWheel", (rx, hatch_y - 19, rz), 22, 3, "brass", (90, 0, 0))
    for index in range(4):
        angle = index * math.pi / 2
        m.pipe(f"SterilizingRetort_WheelSpoke{index}", [(rx, hatch_y - 19, rz),
            (rx + 21 * math.cos(angle), hatch_y - 19, rz + 21 * math.sin(angle))], 2.5, "brass")
        m.box(f"SterilizingRetort_DoorLock{index}", (11, 13, 14),
              (rx + (rr - 7) * math.cos(angle), hatch_y - 10, rz + (rr - 7) * math.sin(angle)), "iron")
    m.pipe("SterilizingRetort_SteamFeed", [(rx, ry, rz + rr - 3), (rx, ry, g + 206),
           (left + 10, ry, g + 206)], 7, "brass")
    m.cyl("SterilizingRetort_PressureGauge", 15, 7, (rx, ry - 10, g + 205), "stone", (90, 0, 0))

    # The central opening feeds an exposed, supported can-sealing conveyor.
    qx, qy = d["conveyorCenter"]
    surface = kit.roller_conveyor(m.c, m.root, m.n("CanConveyor"), (qx, qy, g),
        d["conveyorWidth"], d["conveyorLength"], d["conveyorHeight"], m.m["iron"], m.m["steel"], roller_count=17)
    for index, yy in enumerate((-335, -288, -241, -194, -147)):
        can(m, f"ProductionCan{index}", (qx, yy, surface + 24), radius=22, height=45)
    sy = d["seamerY"]
    for side in (-1, 1):
        m.box(f"SealingPress_Column{side}", (16, 23, 163), (qx + side * 77, sy, g + 81.5), "brick", bevel=3)
        m.box(f"SealingPress_Foot{side}", (37, 44, 10), (qx + side * 77, sy, g + 5), "iron")
    m.box("SealingPress_Bridge", (174, 45, 26), (qx, sy, g + 163), "brick", bevel=4)
    m.cyl("SealingPress_Spindle", 11, 39, (qx, sy, g + 135), "iron")
    m.cyl("SealingPress_Head", 26, 12, (qx, sy, g + 113), "steel")
    kit.gear(m.c, m.root, m.n("SealingPress_DriveWheel"), 25,
             (qx - 89, sy, g + 145), m.m["iron"], axis="X", teeth=10)
    m.box("DoorMachineHood", (263, 79, 11), (cx, front - 31, g + 209), "label_red", (-12, 0, 0), bevel=3)
    for side in (-1, 1):
        m.pipe(f"DoorMachineHood_Bracket{side}", [(cx + side * 116, front - 9, g + 173),
               (cx + side * 116, front - 61, g + 202)], 4, "iron")
    # Large front tin emblem, fixed to the arched end wall rather than floating.
    m.box("TinSign_Mount", (132, 16, 94), (cx, front - 17, top + 47), "brick", bevel=5)
    can(m, "TinSign", (cx, front - 58, top + 48), radius=39, height=79)
    extruded_badge(m, "TinSign_Leaf", (cx, front - 98, top + 48),
                  [(-16, -1), (-5, 13), (17, 17), (10, -3), (-4, -10)], "leaf_green", 4)
    # Small produce and finished-goods stations are clear of the conveyor.
    m.crate("FinishedGoodsCrate", (96, 78, 55), (cx + 148, -264, g + 27.5))
    for index, dx in enumerate((-23, 23)):
        can(m, f"PackedCan{index}", (cx + 148 + dx, -264, g + 76), radius=18, height=38)
    m.crate("ProduceDeliveryCrate", (87, 76, 44), (cx - 153, -275, g + 22))
    for index, dx in enumerate((-21, 17)):
        m.cyl(f"ProduceDelivery_RedFood{index}", 19, 19, (cx - 153 + dx, -275, g + 51), "label_red")
        extruded_badge(m, f"ProduceDelivery_Leaf{index}", (cx - 153 + dx, -287, g + 66),
                      [(-12, 0), (0, 11), (14, 2), (1, -4)], "leaf_green", 3)
    return m.root


if __name__ == "__main__":
    manifest_path, asset_id, blend_path, preview_path, depth_path = pack.parse_args()[:5]
    pack.BUILDERS.update(oil_power_plant=build_oil_power_plant, cannery=build_cannery)
    bpy.context.preferences.filepaths.save_version = 0
    pack.main()
    from bpy_extras.object_utils import world_to_camera_view
    source = json.loads(Path(manifest_path).read_text(encoding="utf-8-sig"))
    spec = source["buildings"][asset_id]
    root = bpy.data.objects[asset_id.upper() + "_ROOT_ROT_Z_44_8"]
    scene = bpy.context.scene
    width, depth, height = spec["dimensions"]["foundation"]
    corners = []
    for point in ((-width / 2, -depth / 2, 0), (width / 2, -depth / 2, 0),
                  (width / 2, depth / 2, 0), (-width / 2, depth / 2, 0)):
        p = world_to_camera_view(scene, scene.camera, root.matrix_world @ Vector(point))
        corners.append([round(p.x * 1024, 3), round((1 - p.y) * 1024, 3)])
    (Path(blend_path).parent / "model-metadata.json").write_text(json.dumps({
        "assetId": asset_id, "name": spec["name"], "revision": "v02",
        "status": "model_candidate_awaiting_user_review", "revisionReason": spec["revisionReason"],
        "model": Path(blend_path).name,
        "preview": Path(preview_path).name.replace("_model_preview", "_model_approval_preview"),
        "bodyDepth": Path(depth_path).name, "bodyDepthIncludesFoundation": True,
        "proposedFootprintCells": spec["footprintCells"], "foundationCornersPx": corners,
        "mainStoreys": root["main_storeys"], "cameraElevation": 30, "rootRotationZ": 44.8,
        "objectCount": len(root.children_recursive), "runtimeInstalled": False,
        "aiGenerationStarted": False, "userApproved": False,
        "builder": source["builder"], "baseBuilder": source["baseBuilder"],
        "componentSource": source["componentSource"],
        "priorModel": f"../../{asset_id}/{asset_id}_model.blend"
    }, ensure_ascii=False, indent=2), encoding="utf-8")
