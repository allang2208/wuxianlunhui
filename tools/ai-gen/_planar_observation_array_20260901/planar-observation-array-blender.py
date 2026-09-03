#!/usr/bin/env python3
"""Build the editable World-122 planar observation array.

This task-local builder reuses the canonical component kit, 30-degree camera,
44.8-degree model root, lighting, approval-preview and Depth pipeline from the
settlement building pack.  It only writes the requested model outputs.
"""

import importlib.util
import math
from pathlib import Path


PACK_PATH = Path(__file__).resolve().parents[1] / "settlement-building-pack-blender.py"
MODULE = importlib.util.spec_from_file_location("planar_observation_settlement_pack", PACK_PATH)
pack = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(pack)
kit = pack.kit
bpy = pack.bpy


def build_planar_observation_array(spec):
    building_id = spec["assetId"]
    collection, root, mats = pack.common_context(building_id, spec)
    prefix = "PlanarObservationArray"
    palette = dict(spec["palette"])
    palette.update(spec.get("paletteOverrides", {}))

    def rgba(key):
        return kit.rgba(palette[key])

    mats.update({
        "concrete": kit.material(
            prefix + "_MAT_PreciseWeatheredConcrete", rgba("concrete"),
            roughness=0.88,
            noise={"scale": 4.0, "detail": 2.0, "bump": 0.055,
                   "dark": tuple(c * 0.92 for c in rgba("concrete")[:3]) + (1.0,),
                   "light": tuple(min(1.0, c * 1.045) for c in rgba("concrete")[:3]) + (1.0,)},
        ),
        "panel": kit.material(
            prefix + "_MAT_PaleMineralPanel", rgba("ceramic"),
            roughness=0.82,
            noise={"scale": 5.0, "detail": 1.0, "bump": 0.035,
                   "dark": tuple(c * 0.94 for c in rgba("ceramic")[:3]) + (1.0,),
                   "light": tuple(min(1.0, c * 1.035) for c in rgba("ceramic")[:3]) + (1.0,)},
        ),
        "steel": kit.material(prefix + "_MAT_CharcoalStructuralSteel", rgba("machine"),
                              roughness=0.50, metallic=0.56),
        "bronze": kit.material(prefix + "_MAT_AgedBronze", rgba("brass"),
                               roughness=0.45, metallic=0.62),
        "obs_glass": kit.material(prefix + "_MAT_ObservationGlass", rgba("glass"),
                                  roughness=0.24, metallic=0.04,
                                  emission=(rgba("glass"), 0.22)),
        "lens": kit.material(prefix + "_MAT_PlanarLens", rgba("glow"),
                             roughness=0.20, metallic=0.03,
                             emission=(rgba("glow"), 1.2)),
        "interior": kit.material(prefix + "_MAT_DeepInterior", rgba("interior"),
                                 roughness=0.94),
    })

    def box(name, size, location, material, rotation=(0, 0, 0), bevel=1.5):
        return kit.box(collection, root, prefix + "_" + name, size, location,
                       mats[material], rotation=rotation, bevel_width=bevel)

    def cylinder(name, radius, depth, location, material, rotation=(0, 0, 0),
                 vertices=48, bevel=1.0):
        return kit.cylinder(collection, root, prefix + "_" + name, radius, depth,
                            location, mats[material], rotation=rotation,
                            vertices=vertices, bevel_width=bevel)

    def sphere(name, radius, location, material, scale=(1.0, 1.0, 1.0)):
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=48, ring_count=24, radius=radius, location=location)
        obj = bpy.context.object
        obj.name = prefix + "_" + name
        obj.parent = root
        obj.scale = scale
        obj.data.materials.append(mats[material])
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        kit.move_to_collection(obj, collection)
        return obj

    def window(name, location, width, height, orientation="front", vdiv=3, hdiv=2):
        return kit.framed_glass_panel(
            collection, root, prefix + "_" + name, location, width, height,
            mats["obs_glass"], mats["steel"], mats["bronze"],
            orientation=orientation, vertical_divisions=vdiv,
            horizontal_divisions=hdiv, depth=8.0)

    dims = spec["dimensions"]
    foundation_w, foundation_d, foundation_h = dims["foundation"]
    floor_z = foundation_h + dims["foundationPadHeight"]

    # Complete 4x4 visual foundation.  It remains visual-only; the runtime
    # footprint continues to be the existing 4x4 logical contract.
    box("Foundation_Base", (foundation_w, foundation_d, foundation_h),
        (0, 0, foundation_h / 2), "concrete", bevel=4.0)
    inset = dims["foundationInset"]
    box("Foundation_InsetPad",
        (foundation_w - inset * 2, foundation_d - inset * 2, dims["foundationPadHeight"]),
        (0, 0, foundation_h + dims["foundationPadHeight"] / 2), "panel", bevel=2.0)
    curb_h = 10
    for side in (-1, 1):
        box(f"Foundation_CurbFrontBack_{side}", (foundation_w - 22, 14, curb_h),
            (0, side * (foundation_d / 2 - 9), foundation_h + curb_h / 2),
            "concrete", bevel=2.0)
        box(f"Foundation_CurbLeftRight_{side}", (14, foundation_d - 22, curb_h),
            (side * (foundation_w / 2 - 9), 0, foundation_h + curb_h / 2),
            "concrete", bevel=2.0)

    # A connected academic control hall, inherited from the high-energy
    # laboratory family but with a taller central observation rotunda.
    central_w, central_d, central_h = dims["centralBlock"]
    central_y = dims["centralCenterY"]
    central_front = central_y - central_d / 2
    box("CentralHall_BearingShell", (central_w, central_d, central_h),
        (0, central_y, floor_z + central_h / 2), "panel", bevel=5.0)
    for story in (1, 2):
        z = floor_z + story * (central_h / 3)
        box(f"CentralHall_SlabBand_{story}", (central_w + 15, central_d + 15, 10),
            (0, central_y, z), "steel", bevel=2.0)
    box("CentralHall_RoofPlate", (central_w + 28, central_d + 28, 16),
        (0, central_y, floor_z + central_h + 8), "concrete", bevel=3.0)

    wing_w, wing_d, wing_h = dims["wing"]
    wing_x = dims["wingCenterX"]
    wing_y = dims["wingCenterY"]
    for side in (-1, 1):
        x = side * wing_x
        box(f"Wing_{side}_BearingShell", (wing_w, wing_d, wing_h),
            (x, wing_y, floor_z + wing_h / 2), "panel", bevel=5.0)
        box(f"Wing_{side}_MidSlab", (wing_w + 14, wing_d + 14, 10),
            (x, wing_y, floor_z + wing_h / 2), "steel", bevel=2.0)
        box(f"Wing_{side}_RoofPlate", (wing_w + 26, wing_d + 26, 16),
            (x, wing_y, floor_z + wing_h + 8), "concrete", bevel=3.0)
        for edge in (-1, 1):
            box(f"Wing_{side}_ParapetX_{edge}", (10, wing_d + 18, 25),
                (x + edge * (wing_w / 2 + 7), wing_y,
                 floor_z + wing_h + 23), "concrete", bevel=1.5)
        box(f"Wing_{side}_RearParapet", (wing_w + 18, 10, 25),
            (x, wing_y + wing_d / 2 + 7, floor_z + wing_h + 23),
            "concrete", bevel=1.5)

    # Centered glass entrance with a real dark recess and doors.  Broad solid
    # stairs stay backed by the facade from the final camera direction.
    atrium_w, atrium_d, atrium_h = dims["entranceAtrium"]
    atrium_y = dims["entranceCenterY"]
    atrium_front = atrium_y - atrium_d / 2
    box("EntranceAtrium_Shell", (atrium_w, atrium_d, atrium_h),
        (0, atrium_y, floor_z + atrium_h / 2), "steel", bevel=4.0)
    box("EntranceAtrium_GlassFront", (atrium_w - 28, 7, atrium_h - 24),
        (0, atrium_front - 4, floor_z + atrium_h / 2), "obs_glass", bevel=2.0)
    door_w, door_h = dims["entranceDoor"]
    box("Entrance_DarkRecess", (door_w + 20, 5, door_h + 8),
        (0, atrium_front - 10, floor_z + door_h / 2), "interior", bevel=1.0)
    for side in (-1, 1):
        box(f"Entrance_GlassDoor_{side}", (door_w / 2 - 7, 5, door_h),
            (side * (door_w / 4 + 2), atrium_front - 14, floor_z + door_h / 2),
            "obs_glass", bevel=1.0)
        box(f"Entrance_DoorFrame_{side}", (5, 8, door_h + 8),
            (side * (door_w / 2 + 5), atrium_front - 16, floor_z + door_h / 2),
            "bronze", bevel=0.8)
    box("Entrance_Canopy", (atrium_w + 34, 84, 15),
        (0, atrium_front - 35, floor_z + atrium_h - 20), "concrete", bevel=3.0)
    for side in (-1, 1):
        box(f"Entrance_CanopyColumn_{side}", (13, 13, atrium_h - 26),
            (side * (atrium_w / 2 + 4), atrium_front - 38,
             floor_z + (atrium_h - 26) / 2), "bronze", bevel=1.2)
    for index, (width, depth, yoff, zoff) in enumerate((
            (196, 54, -30, 3), (170, 48, -12, 8), (144, 42, 5, 13)), start=1):
        box(f"Entrance_Step_{index}", (width, depth, 6 + index * 2),
            (0, atrium_front + yoff, foundation_h + zoff), "concrete", bevel=1.5)

    # Broad readable research windows; no hairline facade grid.
    for story, z in enumerate((floor_z + 54, floor_z + 133, floor_z + 211), start=1):
        window(f"Central_FrontWindow_{story}_Left",
               (-88, central_front - 6, z), 82, 47, vdiv=2, hdiv=1)
        window(f"Central_FrontWindow_{story}_Right",
               (88, central_front - 6, z), 82, 47, vdiv=2, hdiv=1)
    for side in (-1, 1):
        x = side * wing_x
        wing_front = wing_y - wing_d / 2
        for story, z in enumerate((floor_z + 53, floor_z + 132), start=1):
            window(f"Wing_{side}_FrontWindow_{story}",
                   (x, wing_front - 6, z), wing_w - 64, 49, vdiv=3, hdiv=1)
        visible_x = x - side * (wing_w / 2 + 5)
        for index, y in enumerate((wing_y - 82, wing_y + 12, wing_y + 106), start=1):
            window(f"Wing_{side}_SideWindow_{index}",
                   (visible_x, y, floor_z + 105), 68, 86,
                   orientation="side", vdiv=2, hdiv=2)

    # Central connected observation rotunda and supported planar interferometer.
    rotunda_z = floor_z + central_h + 25
    cylinder("Rotunda_Base", dims["rotundaRadius"] + 18, 25,
             (0, central_y, rotunda_z), "concrete", vertices=64, bevel=2.0)
    cylinder("Rotunda_GlassDrum", dims["rotundaRadius"], dims["rotundaHeight"],
             (0, central_y, rotunda_z + dims["rotundaHeight"] / 2 + 13),
             "obs_glass", vertices=64, bevel=1.6)
    drum_mid_z = rotunda_z + dims["rotundaHeight"] / 2 + 13
    for index in range(12):
        angle = math.tau * index / 12
        x = math.cos(angle) * (dims["rotundaRadius"] + 3)
        y = central_y + math.sin(angle) * (dims["rotundaRadius"] + 3)
        box(f"Rotunda_Frame_{index+1:02d}", (8, 8, dims["rotundaHeight"] + 16),
            (x, y, drum_mid_z), "steel", rotation=(0, 0, math.degrees(angle)), bevel=0.8)
    cylinder("Rotunda_Crown", dims["rotundaRadius"] + 22, 22,
             (0, central_y, rotunda_z + dims["rotundaHeight"] + 23),
             "bronze", vertices=64, bevel=2.0)

    instrument_z = rotunda_z + dims["rotundaHeight"] + 112
    support_base_z = rotunda_z + dims["rotundaHeight"] + 36
    pier_height = 96
    for side in (-1, 1):
        x = side * 108
        box(f"Interferometer_Pier_{side}", (22, 42, pier_height),
            (x, central_y, support_base_z + pier_height / 2), "steel", bevel=2.0)
        pack.research_diagonal_beam(
            collection, root, prefix + f"_Interferometer_Brace_{side}",
            (x, central_y, support_base_z + 15),
            (side * 72, central_y, instrument_z - 18), 10, 12, mats["steel"])
    box("Interferometer_Crossbeam", (238, 28, 24),
        (0, central_y, instrument_z - 82), "steel", bevel=2.0)
    for name, rotation in (("EquatorialRing", (0, 0, 0)),
                           ("MeridianRing", (90, 0, 0)),
                           ("PolarRing", (0, 90, 0))):
        kit.torus_ring(collection, root, prefix + "_Interferometer_" + name,
                       dims["instrumentRadius"], 8.5,
                       (0, central_y, instrument_z), mats["bronze"],
                       rotation=rotation, major_segments=72, minor_segments=12)
    sphere("Interferometer_PlanarLens", 39, (0, central_y, instrument_z),
           "lens", scale=(0.58, 1.0, 1.0))
    cylinder("Interferometer_CoreAxis", 7, 205,
             (0, central_y, instrument_z), "steel", rotation=(0, 90, 0),
             vertices=24, bevel=0.7)

    # Exactly two roof-mounted shallow observation dishes make the array role
    # readable without turning the building into the unique Tier-5 hub.
    dish_z = floor_z + wing_h + 76
    for side in (-1, 1):
        x = side * wing_x
        cylinder(f"Dish_{side}_Plinth", 34, 18,
                 (x, wing_y + 28, floor_z + wing_h + 31), "concrete", vertices=40)
        cylinder(f"Dish_{side}_Pedestal", 13, 72,
                 (x, wing_y + 28, floor_z + wing_h + 67), "steel", vertices=24)
        pack.weather_parabolic_dish(
            collection, root, prefix + f"_Dish_{side}_Reflector",
            dims["dishRadius"], 20, (x, wing_y + 22, dish_z), 24,
            mats["panel"], mats["bronze"])
        pack.research_diagonal_beam(
            collection, root, prefix + f"_Dish_{side}_FeedArm",
            (x, wing_y - 7, dish_z - 7),
            (x, wing_y - 29, dish_z + 27), 5, 5, mats["steel"])
        sphere(f"Dish_{side}_Feed", 8, (x, wing_y - 30, dish_z + 28), "lens")

    # Wordless orbital-lens emblem above the entrance.
    emblem_z = floor_z + atrium_h - 48
    box("ObservationEmblem_Plaque", (94, 7, 58),
        (0, atrium_front - 17, emblem_z), "steel", bevel=5.0)
    for index, rotation in enumerate(((90, 0, 0), (90, 0, 55), (90, 0, -55)), start=1):
        kit.torus_ring(collection, root, prefix + f"_ObservationEmblem_Orbit_{index}",
                       21, 2.2, (0, atrium_front - 23, emblem_z), mats["bronze"],
                       rotation=rotation, major_segments=32, minor_segments=8)
    sphere("ObservationEmblem_Lens", 7,
           (0, atrium_front - 25, emblem_z), "lens", scale=(1.0, 0.45, 1.0))

    root["asset_status"] = "model_candidate_authorized_for_full_workflow"
    root["building_family"] = "advanced_research"
    root["research_tier"] = 4
    root["footprint_cells"] = 4
    root["logical_ground_projection"] = "512x256 pixels; calibrate final art independently"
    root["identity"] = (
        "connected modern academic planar observatory with one central supported "
        "interferometer and exactly two attached roof dishes")
    return root


if __name__ == "__main__":
    pack.BUILDERS["planar_observation_array"] = build_planar_observation_array
    pack.main()
