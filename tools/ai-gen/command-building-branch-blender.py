#!/usr/bin/env python3
"""Editable command buildings; same CLI/camera/Depth as the settlement pack.

Only produces local model candidates. No runtime assets or game configuration.
"""
import importlib.util
import math
from pathlib import Path

PACK_PATH = Path(__file__).with_name("settlement-building-pack-blender.py")
MODULE = importlib.util.spec_from_file_location("command_settlement_pack", PACK_PATH)
pack = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(pack)
kit = pack.kit
bpy = pack.bpy


def build_command_level(spec):
    level = int(spec["level"])
    collection, root, mats = pack.common_context(spec["assetId"], spec)
    prefix = f"CommandLV{level}"
    palette = dict(spec["palette"])
    palette.update(spec.get("paletteOverrides", {}))
    # Broad material variation, restrained bump, no dense speckled weathering.
    finishes = {
        "foundation": (0.94, 0, 0.09), "stone": (0.88, 0, 0.045),
        "plaster": (0.92, 0, 0.025), "timber": (0.82, 0, 0.05),
        "roof": (0.83, 0, 0.04), "canvas": (0.97, 0, 0.025),
        "brick": (0.88, 0, 0.04), "concrete": (0.91, 0, 0.025),
        "steel": (0.55, 0.42, 0), "accent": (0.60, 0.30, 0),
        "interior": (1.0, 0, 0), "paper": (0.94, 0, 0),
        "banner": (0.95, 0, 0), "glass": (0.29, 0.12, 0),
    }
    for key, (roughness, metallic, bump) in finishes.items():
        color = kit.rgba(palette[key])
        noise = None
        if bump:
            noise = {"scale": 4, "detail": 1, "bump": bump,
                     "dark": tuple(c * 0.91 for c in color[:3]) + (1,),
                     "light": tuple(min(1, c * 1.05) for c in color[:3]) + (1,)}
        mats[key] = kit.material(prefix + "_MAT_" + key, color,
                                roughness=roughness, metallic=metallic, noise=noise)

    def box(name, size, pos, mat, rotation=(0, 0, 0), bevel=1.4):
        return kit.box(collection, root, prefix + "_" + name, size, pos,
                       mats[mat], rotation=rotation, bevel_width=bevel)

    def cylinder(name, radius, depth, pos, mat, rotation=(0, 0, 0), vertices=32):
        return kit.cylinder(collection, root, prefix + "_" + name, radius, depth,
                            pos, mats[mat], rotation=rotation, vertices=vertices)

    def mesh(name, vertices, faces, mat, position=(0, 0, 0)):
        data = bpy.data.meshes.new(prefix + "_" + name + "_Mesh")
        data.from_pydata(vertices, [], faces)
        data.materials.append(mats[mat])
        obj = bpy.data.objects.new(prefix + "_" + name, data)
        collection.objects.link(obj)
        obj.parent = root
        obj.location = position
        return obj

    def beam(name, start, end, width, mat):
        return pack.research_diagonal_beam(collection, root, prefix + "_" + name,
                                            start, end, width, width, mats[mat])

    def window(name, pos, width, height, side=False, divisions=1):
        kit.framed_glass_panel(collection, root, prefix + "_" + name, pos,
                               width, height, mats["glass"],
                               mats["timber" if level == 1 else "steel"], mats["stone"],
                               orientation="side" if side else "front",
                               vertical_divisions=divisions, horizontal_divisions=1, depth=4)

    def compass(name, x, y, z, size=31):
        # A fictional four-point compass; deliberately no text or national insignia.
        box(name + "_Plaque", (size * 1.55, 6, size * 1.55), (x, y, z), "banner", bevel=3)
        kit.torus_ring(collection, root, prefix + "_" + name + "_Ring",
                       size * 0.46, 1.8, (x, y - 5, z), mats["accent"],
                       rotation=(90, 0, 0), major_segments=32, minor_segments=8)
        points = [(0, 0, size * 0.65), (size * .15, 0, size * .15),
                  (size * .53, 0, 0), (size * .15, 0, -size * .15),
                  (0, 0, -size * .65), (-size * .15, 0, -size * .15),
                  (-size * .53, 0, 0), (-size * .15, 0, size * .15)]
        mesh(name + "_Compass", points, [tuple(range(8))], "accent", (x, y - 8, z))

    ground = spec["dimensions"]["foundation"][2]
    floor = ground + 8
    width, depth, height = spec["dimensions"]["body"]
    center_y = spec["dimensions"]["bodyCenterY"]
    front, back = center_y - depth / 2, center_y + depth / 2
    top = floor + height
    foundation_mat = "concrete" if level == 3 else "foundation"
    wall_mat = "canvas" if level == 1 else "brick" if level == 2 else "concrete"
    frame_mat = "timber" if level == 1 else "stone" if level == 2 else "steel"
    box("Foundation_4x4", (400, 400, ground), (0, 0, ground / 2), foundation_mat, bevel=3)
    # A sparse joint pattern and generous landing; never a second larger footprint.
    for i in range(4):
        box(f"Forecourt_Paving_{i}", (96, 58, 2), (-150 + i * 100, -168, ground + 1),
            "stone" if level < 3 else "concrete", bevel=1)
    if level < 3:
        for side in (-1, 1):
            for i in range(5):
                v = -160 + i * 80
                box(f"Foundation_X_{side}_{i}", (77, 9, 12), (v, side * 195, ground - 6), "stone", bevel=2)
                box(f"Foundation_Y_{side}_{i}", (9, 77, 12), (side * 195, v, ground - 6), "stone", bevel=2)

    opening, door_h = (70, 88) if level == 1 else (82, 100)

    def hall(name, x, w, d, h, cy, entrance=False):
        fy, by = cy - d / 2, cy + d / 2
        box(name + "_Floor", (w, d, 8), (x, cy, floor - 4), "stone" if level < 3 else "concrete")
        box(name + "_BackShell", (w, 10, h), (x, by - 5, floor + h / 2), wall_mat)
        for side in (-1, 1):
            box(f"{name}_SideShell_{side}", (10, d, h), (x + side * (w / 2 - 5), cy, floor + h / 2), wall_mat)
        if entrance:
            pier = (w - opening) / 2
            for side in (-1, 1):
                box(f"{name}_FrontPier_{side}", (pier, 10, h),
                    (x + side * (opening / 2 + pier / 2), fy, floor + h / 2), wall_mat)
            box(name + "_DoorHeader", (opening, 10, h - door_h),
                (x, fy, floor + door_h + (h - door_h) / 2), wall_mat)
            box(name + "_EntranceRecess", (opening - 4, 3, door_h),
                (x, fy + 36, floor + door_h / 2), "interior", bevel=0)
            if level < 3:
                kit.double_doors(collection, root, prefix + "_" + name + "_Door",
                                 (x, fy + 3, floor), opening - 8, door_h - 8,
                                 mats["timber"], mats["iron"], open_angle=58)
            else:
                for side in (-1, 1):
                    box(f"Entrance_SlidingGlass_{side}", (22, 4, door_h - 8),
                        (side * (opening / 2 - 9), fy + 8, floor + (door_h - 8) / 2), "glass")
        else:
            box(name + "_FrontShell", (w, 10, h), (x, fy, floor + h / 2), wall_mat)
        # Independently editable floor plates identify actual building levels.
        for story in range(1, 1 + int(h / 95)):
            z = floor + story * 88
            if z < floor + h - 20:
                box(f"{name}_FloorPlate_{story}", (w + 6, d + 6, 8), (x, cy, z), frame_mat)
        box(name + "_Cornice", (w + 12, d + 12, 10), (x, cy, floor + h), frame_mat)

    if level < 3:
        hall("MainHall", 0, width, depth, height, center_y, entrance=True)
        roof_w, roof_d, roof_h = spec["dimensions"]["roof"]
        pack.hipped_roof(collection, root, prefix + "_Roof_Main", roof_w, roof_d,
                         roof_h, (0, center_y, top + 5), mats["canvas" if level == 1 else "roof"])
        box("Roof_Ridge", (roof_w * .85, 13, 10), (0, center_y, top + 5 + roof_h), frame_mat)
        # Attached hip seams or slate courses are large enough to read at game scale.
        if level == 1:
            for side in (-1, 1):
                for xside in (-1, 1):
                    beam(f"Roof_Seam_{side}_{xside}",
                         (xside * roof_w / 2, center_y + side * roof_d / 2, top + 7),
                         (xside * roof_w * .42, center_y + side * roof_d * .08, top + roof_h + 7), 3, "timber")
        else:
            for i in range(1, 6):
                t = i / 7
                row_w = roof_w * (1 - .16 * t)
                y = roof_d * (.5 - .42 * t)
                for side in (-1, 1):
                    box(f"Slate_Course_{i}_{side}", (row_w, 4, 3),
                        (0, center_y + side * y, top + 6 + roof_h * t), "roof", bevel=.5)
        for side in (-1, 1):
            for i, y in enumerate((front + 8, center_y + 23, back - 8)):
                box(f"Wall_Post_{side}_{i}", (12, 14, height),
                    (side * (width / 2 + 1), y, floor + height / 2), frame_mat)
        window("Side_Lower_A", (-width / 2 - 4, center_y - 28, floor + 54), 43, 47, side=True)
        window("Side_Lower_B", (-width / 2 - 4, center_y + 73, floor + 54), 43, 47, side=True)
        for side in (-1, 1):
            window(f"Front_Lower_{side}", (side * (width / 2 - 47), front - 6, floor + 56), 38, 48)
        if level == 2:
            for i, y in enumerate((center_y - 51, center_y + 36, center_y + 104)):
                window(f"Side_Upper_{i}", (-width / 2 - 4, y, floor + 137), 34, 44, side=True)
            for side in (-1, 1):
                window(f"Front_Upper_{side}", (side * 94, front - 6, floor + 137), 38, 44)
            # Chunky stone corner dressings; no per-brick geometry everywhere.
            for side in (-1, 1):
                for i in range(5):
                    box(f"Corner_Quoin_{side}_{i}", (29, 18, 19),
                        (side * (width / 2 - 7), front - 3, floor + 18 + i * 32), "stone")
    else:
        hall("CentralCommandBlock", 0, 132, depth, height, center_y, entrance=True)
        for side in (-1, 1):
            wing_x = side * 114
            hall(f"OfficeWing_{side}", wing_x, 96, depth - 14, 164, center_y + 4)
            box(f"Wing_Roof_{side}", (102, depth - 6, 7), (wing_x, center_y + 4, floor + 171), "steel")
            for edge in (-1, 1):
                box(f"Wing_Parapet_{side}_{edge}", (8, depth, 19),
                    (wing_x + edge * 48, center_y + 4, floor + 180), "concrete")
            for story, z in enumerate((floor + 51, floor + 126)):
                window(f"Wing_Front_{side}_{story}", (wing_x, front + 2, z), 60, 39, divisions=2)
        for story, z in enumerate((floor + 51, floor + 126)):
            for i, y in enumerate((center_y - 63, center_y + 28, center_y + 108)):
                window(f"WestWing_Glass_{story}_{i}", (-166, y, z), 58, 38, side=True, divisions=2)
        window("Central_OperationsGlazing", (0, front - 7, floor + 165), 71, 100, divisions=2)
        box("Central_Roof", (144, depth + 16, 12), (0, center_y, top + 9), "steel")
        for side in (-1, 1):
            box(f"Central_RoofParapet_{side}", (8, depth + 16, 22),
                (side * 70, center_y, top + 22), "concrete")
        box("Central_RoofRearParapet", (140, 8, 22), (0, back + 5, top + 22), "concrete")
        box("Roof_ServiceCabinet", (55, 55, 28), (21, center_y + 51, top + 29), "steel")
        for i in range(3):
            box(f"ServiceCabinet_Vent_{i}", (41, 4, 3), (21, center_y + 21, top + 23 + i * 7), "iron")

    porch_front = -154
    porch_top = floor + (100 if level == 1 else 114)
    for side in (-1, 1):
        box(f"Entrance_Column_{side}", (13 if level == 1 else 19, 18, porch_top - ground),
            (side * 53, porch_front + 9, (porch_top + ground) / 2), frame_mat)
        box(f"Entrance_Foot_{side}", (25, 30, 7), (side * 53, porch_front + 9, ground + 3.5), "stone")
    porch_depth = front - porch_front + 19
    porch_y = (front + porch_front) / 2 + 3
    box("Entrance_Canopy", (130, porch_depth, 11), (0, porch_y, porch_top),
        "timber" if level == 1 else "stone" if level == 2 else "concrete")
    if level == 1:
        pack.hipped_roof(collection, root, prefix + "_Entrance_CanvasRoof", 136, porch_depth + 6,
                         24, (0, porch_y, porch_top + 5), mats["canvas"])
    box("Entrance_Step_Lower", (116, 34, 4), (0, -177, ground + 2), "stone" if level < 3 else "concrete")
    box("Entrance_Step_Upper", (104, 34, 8), (0, -160, ground + 4), "stone" if level < 3 else "concrete")
    compass("Entrance_Identity", 0, porch_front - 3, porch_top + 10, 24 if level == 1 else 29)
    if level == 3:
        compass("CommandBlock_Identity", 0, front - 8, top - 10, 26)

    # Fixed family landmark: a modest command pennant on the western forecourt.
    mast_x, mast_y = -178, -96
    mast_h = 164 if level == 1 else 190
    cylinder("SignalMast_Socket", 13, 13, (mast_x, mast_y, ground + 6.5), "stone")
    cylinder("SignalMast", 3, mast_h, (mast_x, mast_y, ground + mast_h / 2), frame_mat)
    flag_z = ground + mast_h - 7
    mesh("SignalPennant", [(0, 0, 0), (23, -5, -3), (44, 0, -8),
                          (43, 0, -38), (22, -5, -31), (0, 0, -30)],
         [(0, 1, 4, 5), (1, 2, 3, 4)], "banner", (mast_x, mast_y, flag_z))
    beam("Pennant_Trim", (mast_x + 3, mast_y - 1, flag_z - 4),
         (mast_x + 39, mast_y - 1, flag_z - 10), 2, "accent")

    # Small planning station differentiates command buildings from production halls.
    desk_x, desk_y = 111, -133
    box("MapTable_Top", (64, 45, 7), (desk_x, desk_y, ground + 47), frame_mat)
    for side in (-1, 1):
        box(f"MapTable_Trestle_{side}", (8, 35, 42),
            (desk_x + side * 23, desk_y, ground + 23), frame_mat)
    box("MapTable_Map", (50, 31, 1), (desk_x, desk_y - 1, ground + 51), "paper", bevel=0)
    for i, (x, y) in enumerate(((-14, -5), (7, 8), (17, -8))):
        cylinder(f"MapTable_Marker_{i}", 2.5, 4, (desk_x + x, desk_y + y, ground + 53),
                 "accent" if i != 1 else "banner", vertices=12)
    if level == 1:
        box("DispatchCase", (27, 35, 31), (152, -132, ground + 15.5), "timber")
    elif level == 2:
        # Signal box is roof-mounted and physically supported, not floating detail.
        box("Telegraph_RoofHousing", (44, 44, 33), (-87, center_y + 29, top + 59), "stone")
        cylinder("Telegraph_Aerial", 2.5, 64, (-87, center_y + 29, top + 102), "iron")
        box("Telegraph_Crossarm", (48, 4, 4), (-87, center_y + 29, top + 124), "iron")
        for side in (-1, 1):
            cylinder(f"Telegraph_Insulator_{side}", 4, 9,
                     (-87 + side * 19, center_y + 29, top + 130), "stone", vertices=16)
    else:
        # Concave dish, feed arm and pedestal are separate reusable meshes.
        dish_x, dish_y, dish_z = -114, center_y + 34, floor + 220
        cylinder("Communications_Pedestal", 8, 44, (dish_x, dish_y, floor + 193), "steel")
        rings, segments = 5, 40
        verts = [(0, 0, 0)]
        faces = []
        for r in range(1, rings + 1):
            radius = 31 * r / rings
            for j in range(segments):
                a = j * math.tau / segments
                verts.append((math.cos(a) * radius, math.sin(a) * radius, .011 * radius * radius))
        for j in range(segments):
            faces.append((0, 1 + j, 1 + (j + 1) % segments))
        for r in range(rings - 1):
            a, b = 1 + r * segments, 1 + (r + 1) * segments
            for j in range(segments):
                n = (j + 1) % segments
                faces.append((a + j, b + j, b + n, a + n))
        dish = mesh("Communications_Dish", verts, faces, "stone", (dish_x, dish_y, dish_z))
        dish.rotation_euler = (math.radians(24), math.radians(-15), 0)
        solid = dish.modifiers.new("Dish_ShellThickness", "SOLIDIFY")
        solid.thickness = 2
        beam("Communications_FeedArm", (dish_x, dish_y - 24, dish_z + 3),
             (dish_x, dish_y - 12, dish_z + 28), 3, "steel")
        box("Communications_Feed", (7, 9, 7), (dish_x, dish_y - 12, dish_z + 28), "steel")

    root["asset_status"] = "model_candidate_awaiting_user_review"
    root["building_family"] = "expedition_camp"
    root["footprint_cells"] = 4
    root["logical_ground_projection"] = "512x256 pixels; calibrate final art independently"
    root["tier"] = level
    return root


if __name__ == "__main__":
    for building_id in ("command_post", "military_headquarters", "defense_ministry"):
        pack.BUILDERS[building_id] = build_command_level
    pack.main()
