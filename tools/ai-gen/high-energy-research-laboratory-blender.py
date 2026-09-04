#!/usr/bin/env python3
"""Editable World-122 high-energy laboratory model; no runtime art installation."""

import importlib.util
import math
import os
from pathlib import Path
import subprocess


PACK_PATH = Path(__file__).with_name("settlement-building-pack-blender.py")
MODULE = importlib.util.spec_from_file_location("high_energy_lab_settlement_pack", PACK_PATH)
pack = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(pack)
kit, bpy = pack.kit, pack.bpy


def _sphere(collection, root, name, radius, location, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=radius)
    obj = bpy.context.object
    obj.name = name
    obj.parent = root
    obj.location = location
    obj.scale = scale
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    kit.move_to_collection(obj, collection)
    return obj


def _build_rejected_high_energy_factory_v1(spec):
    collection, root, mats = pack.common_context(spec["assetId"], spec)
    prefix = "HighEnergyLab_"
    dims = spec["dimensions"]

    custom_materials = {
        "concrete": (0.86, 0.0, None),
        "brick": (0.82, 0.0, {"scale": 6, "detail": 3, "bump": 0.14}),
        "ceramic": (0.72, 0.04, {"scale": 8, "detail": 2, "bump": 0.05}),
        "conductor": (0.42, 0.72, {"scale": 7, "detail": 3, "bump": 0.09}),
        "machine": (0.46, 0.64, {"scale": 7, "detail": 3, "bump": 0.10}),
        "interior": (0.93, 0.0, None),
    }
    for key, (roughness, metallic, noise) in custom_materials.items():
        color = kit.rgba(spec["palette"][key])
        mats[key] = kit.material(
            prefix + "MAT_" + key,
            color,
            roughness=roughness,
            metallic=metallic,
            noise=noise,
        )

    def box(name, size, position, material="iron", rotation=(0, 0, 0), bevel=2):
        return kit.box(
            collection,
            root,
            prefix + name,
            size,
            position,
            mats[material],
            rotation=rotation,
            bevel_width=bevel,
        )

    def cylinder(name, radius, depth, position, material="iron", rotation=(0, 0, 0), vertices=40):
        obj = kit.cylinder(
            collection,
            root,
            prefix + name,
            radius,
            depth,
            position,
            mats[material],
            rotation=rotation,
            vertices=vertices,
            bevel_width=1.2,
        )
        for polygon in obj.data.polygons:
            polygon.use_smooth = len(polygon.vertices) == 4
        return obj

    def ring(name, radius, thickness, position, material="brass", rotation=(0, 0, 0)):
        return kit.torus_ring(
            collection,
            root,
            prefix + name,
            radius,
            thickness,
            position,
            mats[material],
            rotation=rotation,
            major_segments=40,
            minor_segments=8,
        )

    def pipe(name, points, radius=7, material="conductor"):
        return kit.industrial_pipe_path(
            collection,
            root,
            prefix + name,
            points,
            radius,
            mats[material],
        )

    def window(name, position, width, height, orientation="front", vertical=2, horizontal=2):
        return kit.framed_glass_panel(
            collection,
            root,
            prefix + name,
            position,
            width,
            height,
            mats["glass"],
            mats["iron"],
            mats["brass"],
            orientation=orientation,
            vertical_divisions=vertical,
            horizontal_divisions=horizontal,
            ornaments=False,
            depth=7,
        )

    fw, fd, fh = dims["foundation"]
    inset = dims["foundationInset"]
    pad_h = dims["foundationPadHeight"]
    ground = fh + pad_h
    box("Foundation_Base", (fw, fd, fh), (0, 0, fh / 2), "foundation", bevel=7)
    box(
        "Foundation_InsetPad",
        (fw - inset * 2, fd - inset * 2, pad_h),
        (0, 0, fh + pad_h / 2),
        "concrete",
        bevel=4,
    )
    curb_t, curb_h = 12, 9
    box("Foundation_CurbFront", (fw - 44, curb_t, curb_h), (0, -fd / 2 + 25, ground + curb_h / 2), "stone")
    box("Foundation_CurbBack", (fw - 44, curb_t, curb_h), (0, fd / 2 - 25, ground + curb_h / 2), "stone")
    box("Foundation_CurbLeft", (curb_t, fd - 44, curb_h), (-fw / 2 + 25, 0, ground + curb_h / 2), "stone")
    box("Foundation_CurbRight", (curb_t, fd - 44, curb_h), (fw / 2 - 25, 0, ground + curb_h / 2), "stone")

    # The central hall and wings form one connected bearing mass, with each level
    # retained as an independently editable object.
    main_w, main_d, main_h = dims["mainHall"]
    main_y = dims["mainHallCenterY"]
    main_base = ground + 10
    main_floor_h = main_h / 2
    box("MainHall_Level1_BearingShell", (main_w, main_d, main_floor_h),
        (0, main_y, main_base + main_floor_h / 2), "brick", bevel=5)
    box("MainHall_Level2_BearingShell", (main_w - 18, main_d - 16, main_floor_h),
        (0, main_y + 4, main_base + main_floor_h * 1.5), "plaster", bevel=4)
    box("MainHall_FloorBandFront", (main_w + 18, 15, 14),
        (0, main_y - main_d / 2 - 5, main_base + main_floor_h), "stone")
    box("MainHall_FloorBandLeft", (15, main_d + 8, 14),
        (-main_w / 2 - 5, main_y, main_base + main_floor_h), "stone")
    box("MainHall_FloorBandRight", (15, main_d + 8, 14),
        (main_w / 2 + 5, main_y, main_base + main_floor_h), "stone")
    main_top = main_base + main_h
    box("MainHall_ContinuousRoof", (main_w + 30, main_d + 30, 18),
        (0, main_y, main_top + 9), "roof", bevel=5)
    for side in (-1, 1):
        box(f"MainHall_RoofRailFront_{side}", (main_w / 2 - 12, 10, 18),
            (side * (main_w / 4 + 6), main_y - main_d / 2 - 15, main_top + 22), "stone")
        box(f"MainHall_RoofRailBack_{side}", (main_w / 2 - 12, 10, 18),
            (side * (main_w / 4 + 6), main_y + main_d / 2 + 15, main_top + 22), "stone")

    wing_w, wing_d, wing_h = dims["wing"]
    wing_x, wing_y = dims["wingCenterX"], dims["wingCenterY"]
    wing_floor_h = wing_h / 2
    wing_top = main_base + wing_h
    for side in (-1, 1):
        side_name = "Left" if side < 0 else "Right"
        x = side * wing_x
        box(f"{side_name}Wing_Level1_BearingShell", (wing_w, wing_d, wing_floor_h),
            (x, wing_y, main_base + wing_floor_h / 2), "brick", bevel=4)
        box(f"{side_name}Wing_Level2_BearingShell", (wing_w, wing_d, wing_floor_h),
            (x, wing_y, main_base + wing_floor_h * 1.5), "plaster", bevel=4)
        box(f"{side_name}Wing_FloorBandFront", (wing_w + 12, 13, 12),
            (x, wing_y - wing_d / 2 - 4, main_base + wing_floor_h), "stone")
        box(f"{side_name}Wing_Roof", (wing_w + 24, wing_d + 24, 15),
            (x, wing_y, wing_top + 7.5), "roof", bevel=4)
        for level in (0, 1):
            z = main_base + wing_floor_h * (level + .5)
            window(f"{side_name}Wing_FrontWindow_L{level + 1}",
                   (x, wing_y - wing_d / 2 - 6, z), 92, 52, vertical=2, horizontal=1)
        outer_x = x + side * (wing_w / 2 + 6)
        for index, yy in enumerate((wing_y - 78, wing_y + 72)):
            window(f"{side_name}Wing_OuterWindow_{index}",
                   (outer_x, yy, main_base + 96), 74, 62, orientation="side", vertical=2, horizontal=1)

    # Centered entrance: the shared shell supplies a real recessed opening and
    # jamb-pivoted door leaves. Solid stairs keep all gaps backed by structure.
    entry_w, entry_d, entry_h = dims["entranceHall"]
    entry_y = dims["entranceCenterY"]
    door_w, door_h = dims["entranceDoor"]
    entry = kit.entry_bearing_shell(
        collection,
        root,
        prefix + "EntranceHall",
        (entry_w, entry_d, entry_h),
        (0, entry_y, main_base),
        mats["brick"],
        mats["stone"],
        mats["machine"],
        mats["iron"],
        mats["interior"],
        door_size=(door_w, door_h),
        wall_thickness=16,
        door_open_angle=58,
        recess_depth=62,
    )
    box("EntranceHall_Connector", (entry_w - 24, 54, entry_h - 24),
        (0, entry["back"] + 19, main_base + (entry_h - 24) / 2), "brick", bevel=3)
    box("EntranceHall_Roof", (entry_w + 26, entry_d + 26, 14),
        (0, entry_y, main_base + entry_h + 7), "roof", bevel=4)
    box("EntranceHall_RoofFrontRail", (entry_w + 32, 10, 18),
        (0, entry["front"] - 13, main_base + entry_h + 18), "stone")
    box("EntryApron", (172, 52, 4), (0, -364, ground + 2), "concrete", bevel=2)
    for index, (y, width, height) in enumerate(((-382, 170, 10), (-361, 154, 18), (-341, 138, 26))):
        box(f"EntranceStair_{index + 1}", (width, 27, height),
            (0, y, ground + height / 2), "stone", bevel=2)

    # Main and wing windows stay clearly subordinate to the experiment hardware.
    main_front = main_y - main_d / 2
    for level in (0, 1):
        z = main_base + main_floor_h * (level + .5)
        for side in (-1, 1):
            window(f"MainHall_FrontWindow_L{level + 1}_{side}",
                   (side * 116, main_front - 6, z), 72, 60, vertical=2, horizontal=1)
    for side in (-1, 1):
        for yy in (main_y - 95, main_y + 85):
            window(f"MainHall_SideWindow_{side}_{int(yy)}",
                   (side * (main_w / 2 + 6), yy, main_base + 186),
                   66, 64, orientation="side", vertical=2, horizontal=1)

    # Roof-integrated containment structure. The core is fully supported by the
    # central bearing base; no ring, terminal or glow element floats.
    cbw, cbd, cbh = dims["containmentBase"]
    core_y = dims["containmentCenterY"]
    containment_base_z = main_top + 18
    box("Containment_BearingBase", (cbw, cbd, cbh),
        (0, core_y, containment_base_z + cbh / 2), "concrete", bevel=7)
    box("Containment_BearingBaseFront", (cbw - 24, 12, cbh - 24),
        (0, core_y - cbd / 2 - 4, containment_base_z + cbh / 2), "machine", bevel=3)
    window("Containment_ControlGlass", (0, core_y - cbd / 2 - 11,
           containment_base_z + cbh / 2), 106, 58, vertical=3, horizontal=1)
    core_radius = dims["containmentCoreRadius"]
    core_h = dims["containmentCoreHeight"]
    core_bottom = containment_base_z + cbh - 14
    core_center_z = core_bottom + core_h / 2
    cylinder("Containment_InnerEnergyColumn", core_radius * .54, core_h - 18,
             (0, core_y, core_center_z), "glow", vertices=48)
    cylinder("Containment_LowerSocket", core_radius + 14, 22,
             (0, core_y, core_bottom + 11), "iron", vertices=48)
    cylinder("Containment_UpperCap", core_radius + 10, 20,
             (0, core_y, core_bottom + core_h - 10), "iron", vertices=48)
    for index, z in enumerate((core_bottom + 30, core_center_z, core_bottom + core_h - 30)):
        ring(f"Containment_RestraintRing_{index + 1}", core_radius + 16, 6,
             (0, core_y, z), "conductor")
    for x_side, y_side in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
        box(f"Containment_CagePost_{x_side}_{y_side}", (9, 9, core_h - 4),
            (x_side * (core_radius + 7), core_y + y_side * (core_radius + 7), core_center_z),
            "iron", bevel=1)
    terminal_z = core_bottom + core_h + 16
    _sphere(collection, root, prefix + "Containment_TopTerminal", 28,
            (0, core_y, terminal_z), mats["conductor"], scale=(1, 1, .82))
    cylinder("Containment_TerminalStem", 8, 34, (0, core_y, terminal_z - 21), "iron", vertices=20)

    # Symmetric grounded coil towers bridge the wing fronts and the central core.
    coil_x = dims["coilTowerCenterX"]
    coil_y = dims["coilTowerCenterY"]
    coil_h = dims["coilTowerHeight"]
    for side in (-1, 1):
        side_name = "Left" if side < 0 else "Right"
        x = side * coil_x
        pedestal_top = ground + 34
        box(f"{side_name}Coil_Pedestal", (82, 82, 34),
            (x, coil_y, ground + 17), "concrete", bevel=5)
        box(f"{side_name}Coil_WallBracket", (78, 56, 16),
            (x, coil_y + 56, ground + 72), "iron", bevel=2)
        cylinder(f"{side_name}Coil_CeramicCore", 19, coil_h - 24,
                 (x, coil_y, pedestal_top + (coil_h - 24) / 2), "ceramic", vertices=28)
        for index in range(6):
            z = pedestal_top + 14 + index * ((coil_h - 44) / 5)
            ring(f"{side_name}Coil_Conductor_{index + 1}", 29, 4.2,
                 (x, coil_y, z), "conductor")
        tower_top = pedestal_top + coil_h
        cylinder(f"{side_name}Coil_TopStem", 8, 27,
                 (x, coil_y, tower_top - 12), "iron", vertices=20)
        _sphere(collection, root, prefix + f"{side_name}Coil_Terminal",
                25, (x, coil_y, tower_top + 8), mats["conductor"], scale=(1, 1, .85))
        pipe(f"{side_name}Coil_GroundedConduit", [
            (x, coil_y + 23, ground + 22),
            (x, wing_y - wing_d / 2 - 18, ground + 22),
            (side * 176, wing_y - wing_d / 2 - 18, ground + 22),
            (side * 176, main_front - 12, main_base + 72),
        ], radius=7, material="conductor")

    # One attached capacitor cabinet per wing. Three insulated terminals make the
    # electrical function readable without becoming an extra building or tower.
    cap_w, cap_d, cap_h = dims["wingCapacitorSize"]
    for side in (-1, 1):
        side_name = "Left" if side < 0 else "Right"
        x = side * wing_x
        cap_bottom = wing_top + 15
        box(f"{side_name}WingCapacitor_Housing", (cap_w, cap_d, cap_h),
            (x, wing_y + 32, cap_bottom + cap_h / 2), "machine", bevel=5)
        for index, dx in enumerate((-36, 0, 36)):
            cylinder(f"{side_name}WingCapacitor_Insulator_{index + 1}", 9, 30,
                     (x + dx, wing_y + 32, cap_bottom + cap_h + 15), "ceramic", vertices=20)
            for ring_index in (-1, 0, 1):
                ring(f"{side_name}WingCapacitor_Fin_{index + 1}_{ring_index + 2}", 13, 2.2,
                     (x + dx, wing_y + 32, cap_bottom + cap_h + 8 + ring_index * 7), "conductor")
        pipe(f"{side_name}WingCapacitor_ToCore", [
            (x, wing_y + 32, cap_bottom + 18),
            (side * 175, wing_y + 32, cap_bottom + 18),
            (side * 175, core_y, containment_base_z + 44),
            (side * (cbw / 2 - 8), core_y, containment_base_z + 44),
        ], radius=8, material="conductor")

    # Three-orbit atom emblem is geometry only: no letters, numbers or runes.
    badge_y = entry["front"] - 13
    badge_z = main_base + entry_h - 23
    box("AtomEmblem_Backplate", (86, 8, 58), (0, badge_y, badge_z), "machine", bevel=6)
    for index, rotation in enumerate(((90, 0, 0), (90, 32, 0), (90, -32, 0))):
        orbit = ring(f"AtomEmblem_Orbit_{index + 1}", 21, 2.1,
                     (0, badge_y - 6, badge_z), "brass", rotation=rotation)
        if index > 0:
            orbit.scale.x = 1.12
    _sphere(collection, root, prefix + "AtomEmblem_Nucleus", 6.5,
            (0, badge_y - 10, badge_z), mats["glow"])

    root["asset_status"] = "model_candidate_awaiting_user_review"
    root["footprint_cells"] = 4
    root["research_tier"] = 3
    root["previous_research_building"] = "university"
    root["next_research_building"] = "planar_observation_array"
    root["runtime_integration_active"] = False
    root["entry_axis"] = "local negative Y"
    return root


def build_high_energy_research_laboratory(spec):
    """Bright, prestigious academic laboratory with integrated energy research."""
    collection, root, mats = pack.common_context(spec["assetId"], spec)
    prefix = "HighEnergyLabV2_"
    dims = spec["dimensions"]

    mats["concrete"] = kit.material(
        prefix + "MAT_PrecisePrecastConcrete",
        kit.rgba(spec["palette"]["concrete"]),
        roughness=.78,
        noise={"scale": 9, "detail": 2, "bump": .05},
    )
    mats["interior"] = kit.material(
        prefix + "MAT_RecessedInterior",
        kit.rgba(spec["palette"]["interior"]),
        roughness=.92,
    )
    mats["machine"] = kit.material(
        prefix + "MAT_ArchitecturalMetal",
        kit.rgba(spec["palette"]["machine"]),
        roughness=.43,
        metallic=.58,
        noise={"scale": 8, "detail": 2, "bump": .06},
    )

    def box(name, size, position, material="stone", rotation=(0, 0, 0), bevel=2):
        return kit.box(
            collection, root, prefix + name, size, position, mats[material],
            rotation=rotation, bevel_width=bevel)

    def cylinder(name, radius, depth, position, material="iron",
                 rotation=(0, 0, 0), vertices=40):
        obj = kit.cylinder(
            collection, root, prefix + name, radius, depth, position,
            mats[material], rotation=rotation, vertices=vertices,
            bevel_width=1.2)
        for polygon in obj.data.polygons:
            polygon.use_smooth = len(polygon.vertices) == 4
        return obj

    def ring(name, radius, thickness, position, material="brass",
             rotation=(0, 0, 0)):
        return kit.torus_ring(
            collection, root, prefix + name, radius, thickness, position,
            mats[material], rotation=rotation, major_segments=48,
            minor_segments=8)

    def window(name, position, width, height, orientation="front",
               vertical=2, horizontal=2, ornaments=False):
        return kit.framed_glass_panel(
            collection, root, prefix + name, position, width, height,
            mats["glass"], mats["machine"], mats["brass"],
            orientation=orientation, vertical_divisions=vertical,
            horizontal_divisions=horizontal, ornaments=ornaments, depth=7)

    fw, fd, fh = dims["foundation"]
    inset = dims["foundationInset"]
    pad_h = dims["foundationPadHeight"]
    ground = fh + pad_h
    box("Foundation_Base", (fw, fd, fh), (0, 0, fh / 2),
        "foundation", bevel=8)
    box("Foundation_InsetPad", (fw - inset * 2, fd - inset * 2, pad_h),
        (0, 0, fh + pad_h / 2), "concrete", bevel=4)
    curb_t, curb_h = 12, 8
    box("Foundation_CurbFront", (fw - 46, curb_t, curb_h),
        (0, -fd / 2 + 25, ground + curb_h / 2), "stone")
    box("Foundation_CurbBack", (fw - 46, curb_t, curb_h),
        (0, fd / 2 - 25, ground + curb_h / 2), "stone")
    box("Foundation_CurbLeft", (curb_t, fd - 46, curb_h),
        (-fw / 2 + 25, 0, ground + curb_h / 2), "stone")
    box("Foundation_CurbRight", (curb_t, fd - 46, curb_h),
        (fw / 2 - 25, 0, ground + curb_h / 2), "stone")

    main_w, main_d, main_h = dims["mainBlock"]
    main_y = dims["mainBlockCenterY"]
    base = ground + 12
    main_floor_h = main_h / 3
    main_sizes = (
        (main_w, main_d),
        (main_w - 8, main_d - 8),
        (main_w - 16, main_d - 16),
    )
    for level, (level_w, level_d) in enumerate(main_sizes, start=1):
        z0 = base + (level - 1) * main_floor_h
        box(f"MainBlock_Level{level}_BearingShell",
            (level_w, level_d, main_floor_h),
            (0, main_y, z0 + main_floor_h / 2),
            "plaster" if level > 1 else "stone", bevel=5)
        if level > 1:
            for y_side, face_name in ((-1, "Front"), (1, "Back")):
                box(f"MainBlock_Level{level}_{face_name}Cornice",
                    (level_w + 18, 13, 12),
                    (0, main_y + y_side * (level_d / 2 + 4), z0),
                    "brass", bevel=1.5)
            for x_side, face_name in ((-1, "Left"), (1, "Right")):
                box(f"MainBlock_Level{level}_{face_name}Cornice",
                    (13, level_d + 14, 12),
                    (x_side * (level_w / 2 + 4), main_y, z0),
                    "brass", bevel=1.5)
    main_top = base + main_h
    box("MainBlock_Roof", (main_w + 28, main_d + 28, 16),
        (0, main_y, main_top + 8), "roof", bevel=5)
    for side in (-1, 1):
        box(f"MainBlock_RoofParapetFront_{side}",
            (main_w / 2 - 10, 10, 16),
            (side * (main_w / 4 + 5), main_y - main_d / 2 - 14,
             main_top + 20), "stone")
        box(f"MainBlock_RoofParapetSide_{side}",
            (10, main_d + 18, 16),
            (side * (main_w / 2 + 14), main_y, main_top + 20), "stone")

    # Two broad, symmetric laboratory wings create a formal academic frontage.
    wing_w, wing_d, wing_h = dims["wing"]
    wing_x, wing_y = dims["wingCenterX"], dims["wingCenterY"]
    wing_floor_h = wing_h / 2
    wing_top = base + wing_h
    for side in (-1, 1):
        side_name = "Left" if side < 0 else "Right"
        x = side * wing_x
        for level in (1, 2):
            z0 = base + (level - 1) * wing_floor_h
            box(f"{side_name}Wing_Level{level}_BearingShell",
                (wing_w, wing_d, wing_floor_h),
                (x, wing_y, z0 + wing_floor_h / 2),
                "stone" if level == 1 else "plaster", bevel=5)
            if level == 2:
                box(f"{side_name}Wing_Level2_FrontCornice",
                    (wing_w + 16, 13, 12),
                    (x, wing_y - wing_d / 2 - 4, z0), "brass", bevel=1.5)
        box(f"{side_name}Wing_Roof", (wing_w + 26, wing_d + 26, 15),
            (x, wing_y, wing_top + 7.5), "roof", bevel=5)
        box(f"{side_name}Wing_RoofFrontParapet", (wing_w + 28, 10, 18),
            (x, wing_y - wing_d / 2 - 14, wing_top + 20), "stone")

        # Repeated large windows read as research floors rather than a factory bay.
        front_y = wing_y - wing_d / 2 - 7
        for level in (0, 1):
            z = base + wing_floor_h * (level + .5)
            for bay, dx in enumerate((-62, 62), start=1):
                window(f"{side_name}Wing_L{level + 1}_FrontLabWindow_{bay}",
                       (x + dx, front_y, z), 82, 60,
                       vertical=2, horizontal=1)
        outer_x = x + side * (wing_w / 2 + 7)
        for level in (0, 1):
            z = base + wing_floor_h * (level + .5)
            for bay, yy in enumerate((wing_y - 74, wing_y + 76), start=1):
                window(f"{side_name}Wing_L{level + 1}_OuterLabWindow_{bay}",
                       (outer_x, yy, z), 78, 58, orientation="side",
                       vertical=2, horizontal=1)
        for column_x in (x - wing_w / 2 + 17, x + wing_w / 2 - 17):
            box(f"{side_name}Wing_FacadePilaster_{int(column_x)}",
                (14, 18, wing_h - 16),
                (column_x, front_y - 2, base + wing_h / 2), "stone", bevel=2)

        # One low glazed skylight per wing keeps all equipment architectural.
        sky_l, sky_w, sky_h = dims["wingSkylight"]
        sky_base = wing_top + 15
        kit.gabled_prism(
            collection, root, prefix + f"{side_name}Wing_SkylightGlass",
            sky_l, sky_w, sky_h, (x, wing_y + 16, sky_base),
            mats["glass"], mats["glass"])
        box(f"{side_name}Wing_SkylightRidge", (sky_l + 8, 7, 7),
            (x, wing_y + 16, sky_base + sky_h), "brass", bevel=1)
        slope_angle = math.degrees(math.atan2(sky_h, sky_w / 2))
        slope_length = math.sqrt((sky_w / 2) ** 2 + sky_h ** 2)
        for rib, dx in enumerate((-42, 0, 42), start=1):
            for slope_side in (-1, 1):
                box(f"{side_name}Wing_SkylightRib_{rib}_{slope_side}",
                    (6, slope_length + 4, 5),
                    (x + dx, wing_y + 16 + slope_side * sky_w / 4,
                     sky_base + sky_h / 2 + 1),
                    "machine", rotation=(-slope_side * slope_angle, 0, 0),
                    bevel=.6)

    # A centered glazed atrium, formal canopy and wide backed stairs establish a
    # prestigious public entrance rather than an industrial service door.
    atrium_w, atrium_d, atrium_h = dims["entranceAtrium"]
    atrium_y = dims["entranceCenterY"]
    door_w, door_h = dims["entranceDoor"]
    atrium = kit.entry_bearing_shell(
        collection, root, prefix + "EntranceAtrium",
        (atrium_w, atrium_d, atrium_h), (0, atrium_y, base),
        mats["plaster"], mats["stone"], mats["machine"], mats["brass"],
        mats["interior"], door_size=(door_w, door_h), wall_thickness=17,
        door_open_angle=55, recess_depth=72)
    box("EntranceAtrium_Connector", (atrium_w - 34, 78, atrium_h - 34),
        (0, atrium["back"] + 29, base + (atrium_h - 34) / 2),
        "plaster", bevel=4)
    box("EntranceAtrium_Roof", (atrium_w + 24, atrium_d + 24, 14),
        (0, atrium_y, base + atrium_h + 7), "roof", bevel=5)
    window("EntranceAtrium_UpperGlass",
           (0, atrium["front"] - 7, base + atrium_h - 45),
           178, 62, vertical=4, horizontal=1, ornaments=True)
    for side in (-1, 1):
        window(f"EntranceAtrium_LowerGlass_{side}",
               (side * 82, atrium["front"] - 7, base + 64),
               46, 76, vertical=1, horizontal=2)
        window(f"EntranceAtrium_SideGlass_{side}",
               (side * (atrium_w / 2 + 7), atrium_y - 4, base + 105),
               118, 92, orientation="side", vertical=3, horizontal=2)

    canopy_z = base + door_h + 24
    box("EntranceCanopy", (234, 72, 10),
        (0, atrium["front"] - 34, canopy_z), "glass", bevel=3)
    box("EntranceCanopy_FrontBronze", (240, 8, 13),
        (0, atrium["front"] - 69, canopy_z), "brass", bevel=1.5)
    for side in (-1, 1):
        cylinder(f"EntranceCanopy_Column_{side}", 8, canopy_z - ground,
                 (side * 91, atrium["front"] - 58,
                  ground + (canopy_z - ground) / 2), "stone", vertices=20)
        box(f"EntranceCanopy_ColumnFoot_{side}", (30, 30, 8),
            (side * 91, atrium["front"] - 58, ground + 4), "stone")

    box("EntryApron", (212, 52, 4),
        (0, -349, ground + 2), "concrete", bevel=2)
    for index, (y, width, height) in enumerate(
            ((-370, 206, 10), (-352, 190, 18), (-334, 174, 26)), start=1):
        box(f"EntranceStair_{index}", (width, 25, height),
            (0, y, ground + height / 2), "stone", bevel=2)

    # The central academic block uses tall, ordered glazing with stone pilasters.
    main_front = main_y - main_d / 2
    for level in (1, 2, 3):
        z = base + main_floor_h * (level - .5)
        for side in (-1, 1):
            window(f"MainBlock_L{level}_FrontWindow_{side}",
                   (side * 104, main_front - 7, z), 64, 54,
                   vertical=2, horizontal=1)
    for side in (-1, 1):
        for level in (1, 2, 3):
            z = base + main_floor_h * (level - .5)
            window(f"MainBlock_L{level}_SideWindow_{side}",
                   (side * (main_w / 2 + 7), main_y + 58, z),
                   76, 54, orientation="side", vertical=2, horizontal=1)
        box(f"MainBlock_FrontPilaster_{side}", (18, 18, main_h - 18),
            (side * 148, main_front - 2, base + main_h / 2),
            "stone", bevel=2)

    # A compact glass energy pavilion is built into the roof. One restrained ring
    # and a glazed dome communicate high-energy research without factory clutter.
    pav_w, pav_d, pav_h = dims["energyPavilion"]
    pav_y = dims["energyPavilionCenterY"]
    pav_base = main_top + 16
    box("EnergyPavilion_BearingBase", (pav_w, pav_d, pav_h),
        (0, pav_y, pav_base + pav_h / 2), "plaster", bevel=7)
    box("EnergyPavilion_BronzeCornice", (pav_w + 18, pav_d + 18, 12),
        (0, pav_y, pav_base + pav_h - 6), "brass", bevel=2)
    window("EnergyPavilion_FrontObservationGlass",
           (0, pav_y - pav_d / 2 - 7, pav_base + pav_h / 2),
           116, 52, vertical=3, horizontal=1, ornaments=True)
    drum_r = dims["energyDrumRadius"]
    drum_h = dims["energyDrumHeight"]
    drum_bottom = pav_base + pav_h - 4
    drum_center_z = drum_bottom + drum_h / 2
    cylinder("EnergyPavilion_GlassDrum", drum_r, drum_h,
             (0, pav_y, drum_center_z), "glass", vertices=48)
    cylinder("EnergyPavilion_SupportedCore", 25, drum_h - 16,
             (0, pav_y, drum_center_z), "glow", vertices=40)
    ring("EnergyPavilion_LowerRing", drum_r + 5, 5,
         (0, pav_y, drum_bottom + 5), "brass")
    ring("EnergyPavilion_UpperRing", drum_r + 5, 5,
         (0, pav_y, drum_bottom + drum_h - 5), "brass")
    for index in range(8):
        angle = math.tau * index / 8
        x = math.cos(angle) * (drum_r + 1)
        y = pav_y + math.sin(angle) * (drum_r + 1)
        box(f"EnergyPavilion_DrumMullion_{index + 1}", (6, 6, drum_h - 8),
            (x, y, drum_center_z), "machine", bevel=.7)
    dome_center_z = drum_bottom + drum_h + 5
    _sphere(collection, root, prefix + "EnergyPavilion_GlassDome",
            drum_r + 12, (0, pav_y, dome_center_z), mats["glass"],
            scale=(1, 1, .58))
    ring("EnergyPavilion_DomeBaseRing", drum_r + 13, 5,
         (0, pav_y, dome_center_z), "brass")
    cylinder("EnergyPavilion_FinalStem", 6, 28,
             (0, pav_y, dome_center_z + 47), "brass", vertices=20)
    _sphere(collection, root, prefix + "EnergyPavilion_FinalOrb", 10,
            (0, pav_y, dome_center_z + 62), mats["brass"])

    # Wordless atom emblem: the public-facing identity is scientific, not industrial.
    badge_y = atrium["front"] - 16
    badge_z = base + atrium_h - 44
    for index, rotation in enumerate(
            ((90, 0, 0), (90, 34, 0), (90, -34, 0)), start=1):
        orbit = ring(f"AtomEmblem_Orbit_{index}", 22, 2.2,
                     (0, badge_y, badge_z), "brass", rotation=rotation)
        if index > 1:
            orbit.scale.x = 1.10
    _sphere(collection, root, prefix + "AtomEmblem_Nucleus", 6.5,
            (0, badge_y - 4, badge_z), mats["glow"])
    for index, (dx, dz) in enumerate(((-21, 3), (14, 17), (13, -17)), start=1):
        _sphere(collection, root, prefix + f"AtomEmblem_Electron_{index}",
                3.5, (dx, badge_y - 5, badge_z + dz), mats["brass"])

    root["asset_status"] = "model_v2_candidate_awaiting_user_review"
    root["footprint_cells"] = 4
    root["research_tier"] = 3
    root["visual_direction"] = "bright_prestigious_academic_laboratory"
    root["previous_research_building"] = "university"
    root["next_research_building"] = "planar_observation_array"
    root["runtime_integration_active"] = False
    root["entry_axis"] = "local negative Y"
    return root


def spawn_custom_body_depth(manifest_path, building_id, blend_path,
                            preview_path, depth_path, body_depth_path):
    command = [
        bpy.app.binary_path,
        "--background",
        "--factory-startup",
        "--python",
        str(Path(__file__).resolve()),
        "--",
        manifest_path,
        building_id,
        blend_path,
        preview_path,
        depth_path,
        body_depth_path,
        "--body-only",
    ]
    completed = subprocess.run(command, check=False)
    if completed.returncode != 0:
        raise SystemExit(
            f"isolated body-depth render failed for {building_id}: "
            f"exit {completed.returncode}"
        )


if __name__ == "__main__":
    pack.BUILDERS["high_energy_research_laboratory"] = build_high_energy_research_laboratory
    pack.spawn_saved_body_depth = spawn_custom_body_depth
    pack.main()
