#!/usr/bin/env python3
"""Editable engineer branch models; reuse the World-122 component/render pipeline.

Usage matches settlement-building-pack-blender.py: manifest id blend preview depth.
This script produces local model candidates only, never runtime assets or AI jobs.
"""
import importlib.util
import math
from pathlib import Path

PACK_PATH = Path(__file__).with_name("settlement-building-pack-blender.py")
MODULE_SPEC = importlib.util.spec_from_file_location("engineer_settlement_pack", PACK_PATH)
pack = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(pack)
kit = pack.kit


def build_engineer_level(spec):
    level = int(spec["level"])
    asset_id = spec["assetId"]
    collection, root, mats = pack.common_context(asset_id, spec)
    dims = spec["dimensions"]
    prefix = f"EngineerLV{level}"
    palette = dict(spec["palette"])
    palette.update(spec.get("paletteOverrides", {}))
    for key, roughness, metallic in (
        ("leather", 0.9, 0), ("concrete", 0.92, 0),
        ("steel", 0.65, 0.38), ("accent", 0.7, 0.18),
        ("interior", 1.0, 0),
    ):
        mats[key] = kit.material(prefix + "_MAT_" + key, kit.rgba(palette[key]),
                                 roughness=roughness, metallic=metallic)

    def box(name, size, position, material, rotation=(0, 0, 0), bevel=1.2):
        return kit.box(collection, root, prefix + "_" + name, size, position,
                       mats[material], rotation=rotation, bevel_width=bevel)

    def cylinder(name, radius, depth, position, material, rotation=(0, 0, 0)):
        return kit.cylinder(collection, root, prefix + "_" + name, radius, depth,
                            position, mats[material], rotation=rotation,
                            vertices=32, bevel_width=0.8)

    foundation_size = dims["foundation"]
    ground = foundation_size[2]
    foundation_mat = "concrete" if level == 3 else "foundation"
    box("Foundation_Base", foundation_size, (0, 0, ground / 2), foundation_mat, bevel=3)
    # Quiet, broad courses at the perimeter, never a second plinth outside the grid.
    if level < 3:
        half = foundation_size[0] / 2
        for side in (-1, 1):
            for index in range(5):
                offset = -half + (index + 0.5) * foundation_size[0] / 5
                box(f"Foundation_EdgeX_{side}_{index}", (76, 9, 10),
                    (offset, side * (half - 5), ground - 5), "stone", bevel=2)
                box(f"Foundation_EdgeY_{side}_{index}", (9, 76, 10),
                    (side * (half - 5), offset, ground - 5), "stone", bevel=2)

    width, depth, height = dims["body"]
    center_y = dims["bodyCenterY"]
    front_y, back_y = center_y - depth / 2, center_y + depth / 2
    opening = dims["bayWidth"]
    bay_height = dims["bayHeight"]
    top_z = ground + height
    wall_mat = "leather" if level == 1 else "stone" if level == 2 else "concrete"
    frame_mat = "timber" if level < 3 else "steel"
    wall_thickness = 8 if level == 1 else 14
    # Separate back, side and split-front shells leave a REAL empty service bay.
    box("Wall_Back", (width, wall_thickness, height),
        (0, back_y - wall_thickness / 2, ground + height / 2), wall_mat)
    for side in (-1, 1):
        box(f"Wall_Side_{side}", (wall_thickness, depth, height),
            (side * (width / 2 - wall_thickness / 2), center_y, ground + height / 2), wall_mat)
        wing_width = (width - opening) / 2
        box(f"Wall_FrontPier_{side}", (wing_width, wall_thickness, height),
            (side * (opening / 2 + wing_width / 2), front_y, ground + height / 2), wall_mat)
        for y_index, y in enumerate((front_y - 5, center_y, back_y - 3)):
            box(f"Frame_Column_{side}_{y_index}", (12, 12, height + 5),
                (side * (width / 2 + 2), y, ground + height / 2), frame_mat)
    box("Bay_Header", (opening + 12, 18, height - bay_height),
        (0, front_y - 2, ground + bay_height + (height - bay_height) / 2), wall_mat)
    box("Frame_FrontLintel", (width + 24, 17, 13), (0, front_y - 9, top_z - 4), frame_mat)
    for side in (-1, 1):
        box(f"Bay_Jamb_{side}", (12, 18, bay_height),
            (side * (opening / 2 + 1), front_y - 9, ground + bay_height / 2), frame_mat)
    box("Bay_RecessWall", (opening - 4, 4, bay_height),
        (0, back_y - 14, ground + bay_height / 2), "interior")
    box("Bay_Floor", (opening - 6, depth - 20, 3),
        (0, center_y - 2, ground + 1.5), "timber" if level < 3 else "steel")

    roof_length, roof_width, roof_height = dims["roof"]
    if level < 3:
        roof_mat = "thatch" if level == 1 else "roof"
        kit.gabled_prism(collection, root, prefix + "_Roof_Main", roof_length,
                         roof_width, roof_height, (0, center_y, top_z),
                         mats[wall_mat], mats[roof_mat])
        kit.roof_rows(collection, root, prefix + "_Roof_Courses", roof_length,
                      roof_width, roof_height, top_z, mats[roof_mat],
                      rows=7 if level == 1 else 8, center=(0, center_y))
        box("Roof_RidgeCap", (roof_length + 4, 13, 10),
            (0, center_y, top_z + roof_height + 2), "timber" if level == 1 else "roof")
    else:
        box("Roof_FlatDeck", (roof_length, roof_width, 10),
            (0, center_y, top_z + 5), "steel")
        # Three attached shallow roof monitors read as an industrial assembly hall.
        for index, offset in enumerate((-78, 0, 78)):
            kit.gabled_prism(collection, root, prefix + f"_RoofMonitor_{index}",
                             roof_length - 24, 62, roof_height,
                             (0, center_y + offset, top_z + 10), mats["steel"], mats["steel"])
            box(f"RoofMonitor_Glazing_{index}", (roof_length - 44, 23, 2),
                (0, center_y + offset - 15, top_z + 10 + roof_height / 2 + 2),
                "glass", rotation=(math.degrees(math.atan2(roof_height, 31)), 0, 0))
        for side in (-1, 1):
            box(f"Roof_Parapet_{side}", (10, roof_width, 16),
                (side * (roof_length / 2 - 4), center_y, top_z + 14), "concrete")
        # Raised shutter is attached above the clear opening, not blocking it.
        for index in range(4):
            box(f"Bay_RaisedShutter_{index}", (opening - 8, 7, 7),
                (0, front_y - 14, ground + bay_height - 5 - index * 8), "steel")
        for side in (-1, 1):
            box(f"Bay_SafetyPost_{side}", (10, 10, 44),
                (side * (opening / 2 + 14), front_y - 28, ground + 22), "accent")
            box(f"Facade_AccentBand_{side}", ((width - opening) / 2 - 12, 5, 12),
                (side * (opening / 2 + (width - opening) / 4), front_y - 9, ground + 46), "accent")

    if level == 1:
        for side in (-1, 1):
            # Rolled leather entrance flaps retain the camp's soft construction.
            cylinder(f"Leather_RolledFlap_{side}", 8, bay_height - 5,
                     (side * (opening / 2 - 6), front_y - 16, ground + bay_height / 2), "leather")
            for index in range(4):
                box(f"Leather_Tie_{side}_{index}", (17, 3, 3),
                    (side * (width / 2), front_y - 8, ground + 26 + index * 28), "timber")
        box("Leather_SideSeam", (3, depth - 14, 3),
            (-width / 2 - 2, center_y, ground + height * 0.42), "timber", bevel=0.5)
        for index in range(7):
            box(f"Leather_Stitch_{index}", (3, 3, 10),
                (-width / 2 - 4, center_y - 84 + index * 28, ground + height * 0.42),
                "straw", rotation=(16, 0, 0), bevel=0.4)
    elif level == 2:
        kit.double_doors(collection, root, prefix + "_OpenServiceDoors",
                         (0, front_y - 26, ground + 2), opening - 8, bay_height - 6,
                         mats["timber"], mats["iron"], open_angle=72)
        # Sparse structural masonry belts, not dense noise over the facade.
        for index in range(3):
            z = ground + 35 + index * 43
            box(f"Stone_CourseSide_{index}", (3, depth - 10, 3),
                (width / 2 + 1, center_y, z), "foundation", bevel=0.3)
        kit.chimney(collection, root, prefix + "_ForgeVent", (-100, back_y - 40, top_z),
                    mats["stone"], mats["iron"], height=roof_height + 35)

    # Camera sees local -X: place the identity on that wall, clear of the hoist.
    kit.gear(collection, root, prefix + "_IdentityGear", 20 if level < 3 else 25,
             (-width / 2 - 12, center_y - 48, ground + height * 0.68),
             mats["brass"] if level < 3 else mats["accent"], axis="X", teeth=10)
    kit.workbench(collection, root, prefix + "_Workbench", (89, -150, ground),
                  mats["timber"] if level < 3 else mats["steel"], mats["iron"])
    box("ToolRack_Back", (78, 6, 48), (89, -127, ground + 77), frame_mat)
    for index in range(3):
        box(f"ToolRack_Tool_{index}", (5, 5, 25),
            (65 + index * 24, -133, ground + 78), "iron")
        box(f"ToolRack_ToolHead_{index}", (17, 7, 7),
            (65 + index * 24, -133, ground + 88), "iron")

    hoist_x, hoist_y, hoist_height = dims["hoist"]
    for side in (-1, 1):
        box(f"Hoist_Post_{side}", (13, 13, hoist_height),
            (hoist_x + side * 44, hoist_y, ground + hoist_height / 2), frame_mat)
        box(f"Hoist_Foot_{side}", (31, 44, 8),
            (hoist_x + side * 44, hoist_y, ground + 4), frame_mat)
    box("Hoist_Crossbeam", (112, 18, 18),
        (hoist_x, hoist_y, ground + hoist_height), frame_mat)
    cylinder("Hoist_Pulley", 15, 12,
             (hoist_x, hoist_y - 9, ground + hoist_height - 17), "iron", (90, 0, 0))
    cylinder("Hoist_Cable", 1.7, hoist_height * 0.42,
             (hoist_x, hoist_y - 12, ground + hoist_height * 0.60), "iron")
    kit.torus_ring(collection, root, prefix + "_Hoist_HookRing", 7, 2,
                   (hoist_x, hoist_y - 12, ground + hoist_height * 0.38), mats["iron"],
                   rotation=(90, 0, 0), major_segments=24, minor_segments=8)
    if level > 1:
        cylinder("Hoist_WinchMotor", 17, 28,
                 (hoist_x - 37, hoist_y - 9, ground + 35), "iron", (90, 0, 0))
        kit.gear(collection, root, prefix + "_Hoist_WinchGear", 17,
                 (hoist_x - 37, hoist_y - 26, ground + 35), mats["brass"], teeth=8)
    # Wheel/axle stock is workshop equipment, not a baked-in vehicle or unit.
    for side in (-1, 1):
        cylinder(f"AxleStock_Wheel_{side}", 22, 10,
                 (hoist_x + side * 26, hoist_y - 6, ground + 22),
                 "timber" if level < 3 else "iron", (0, 90, 0))
    cylinder("AxleStock_Shaft", 5, 70, (hoist_x, hoist_y - 6, ground + 22), "iron", (0, 90, 0))

    # One window behind the side badge, on the camera-facing wall.
    if level > 1:
        for index, y in enumerate((center_y + 49,)):
            kit.framed_glass_panel(collection, root, prefix + f"_SideWindow_{index}",
                                   (-width / 2 - 5, y, ground + height * 0.64),
                                   59, 51 if level == 2 else 65, mats["glass"],
                                   mats[frame_mat], mats[frame_mat], orientation="side",
                                   vertical_divisions=2, horizontal_divisions=1)
    root["asset_status"] = "model_candidate_awaiting_user_review"
    root["footprint_cells"] = spec["footprintCells"]
    root["building_family"] = "engineer_camp"
    root["tier"] = level
    return root


if __name__ == "__main__":
    for building_id in ("engineer_camp", "engineering_workshop", "vehicle_factory"):
        pack.BUILDERS[building_id] = build_engineer_level
    pack.main()
