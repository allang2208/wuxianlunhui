"""Mining guild model proposal using the World-122 component/render contract."""
import importlib.util
import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
MODULE = importlib.util.spec_from_file_location(
    "mining_guild_pack", REPO / "tools/ai-gen/settlement-building-pack-blender.py")
pack = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(pack)
kit, bpy, Vector = pack.kit, pack.bpy, pack.mathutils.Vector


def guild_mesh(collection, parent, name, points, faces, mat):
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(points, [], faces)
    mesh.update()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    return obj


def build_mining_guild(spec):
    collection, root, mats = pack.common_context("mining_guild", spec)
    dims = spec["dimensions"]
    prefix = "MiningGuild_"
    # Broad color blocks for model review, without dense surface noise.
    for key, color in spec["palette"].items():
        metallic = .55 if key in ("iron", "brass", "steel") else 0
        mats[key] = kit.material(prefix + "MAT_" + key, kit.rgba(color),
                                 roughness=.54 if metallic else .84,
                                 metallic=metallic)

    def box(name, size, loc, mat="timber", rotation=(0, 0, 0), bevel=1.8, parent=root):
        return kit.box(collection, parent, prefix + name, size, loc, mats[mat],
                       rotation=rotation, bevel_width=bevel)

    def cyl(name, radius, depth, loc, mat="iron", rotation=(0, 0, 0), vertices=24):
        return kit.cylinder(collection, root, prefix + name, radius, depth, loc,
                            mats[mat], rotation=rotation, vertices=vertices)

    def beam(name, start, end, thickness=12, mat="timber"):
        start, end = Vector(start), Vector(end)
        obj = box(name, (thickness, thickness, (end - start).length),
                  (start + end) / 2, mat)
        obj.rotation_euler = (end - start).to_track_quat("Z", "Y").to_euler()
        return obj

    fw, fd, ground = dims["foundation"]
    box("Foundation_FieldstoneCore", (fw - 10, fd - 10, ground - 4),
        (0, 0, ground / 2), "foundation", bevel=6)
    # The perimeter is real masonry, not a smooth modern concrete plinth.
    count, border = 10, 30
    for axis, length in ((0, fw), (1, fd)):
        for side in (-1, 1):
            for index in range(count):
                along = -length / 2 + (index + .5) * length / count
                size = (length / count - 2, border, ground) if axis == 0 else (border, length / count - 2, ground)
                loc = (along, side * (fd / 2 - border / 2), ground / 2) if axis == 0 else (side * (fw / 2 - border / 2), along, ground / 2)
                box(f"Foundation_Edge_{axis}_{side}_{index}", size, loc,
                    "stone" if index % 4 == 1 else "foundation", bevel=4)

    hx, hy = dims["hallCenter"]
    bw, bd = dims["hallBody"]
    first_h, second_h = dims["floors"]
    wall = dims["wallThickness"]
    front, back, left, right = hy - bd / 2, hy + bd / 2, hx - bw / 2, hx + bw / 2
    dw, dh = dims["door"]
    # Independent bearing shells. The entry is an actual recess between wall pieces.
    for name, x in (("Left", left + wall / 2), ("Right", right - wall / 2)):
        box("Floor1_" + name + "Wall", (wall, bd, first_h),
            (x, hy, ground + first_h / 2), "stone", bevel=3)
    box("Floor1_BackWall", (bw, wall, first_h), (hx, back - wall / 2, ground + first_h / 2), "stone", bevel=3)
    side_width = (bw - dw) / 2
    for side in (-1, 1):
        box(f"Floor1_FrontPier_{side}", (side_width, wall, first_h),
            (hx + side * (dw + side_width) / 2, front + wall / 2, ground + first_h / 2), "stone", bevel=3)
    box("Floor1_EntryLintelWall", (dw, wall, first_h - dh),
        (hx, front + wall / 2, ground + dh + (first_h - dh) / 2), "stone", bevel=3)
    box("Entry_InteriorBack", (dw, 8, dh), (hx, front + 95, ground + dh / 2), "interior")
    box("Entry_InteriorFloor", (dw, 94, 5), (hx, front + 46, ground + 2.5), "timber")
    for side in (-1, 1):
        box(f"Entry_Jamb_{side}", (17, 27, dh + 10),
            (hx + side * (dw / 2 + 6), front - 5, ground + (dh + 10) / 2), "timber")
    box("Entry_Lintel", (dw + 42, 27, 19), (hx, front - 5, ground + dh + 9), "timber")
    kit.double_doors(collection, root, prefix + "Entry_Door", (hx, front - 6, ground + 3),
                     dw, dh - 4, mats["timber"], mats["iron"], open_angle=dims["doorOpenAngle"])
    # Correct the reused leaf centers to rotate around the jamb hinges.
    for side in (-1, 1):
        leaf = bpy.data.objects[prefix + f"Entry_Door_Leaf_{side:+d}"]
        half_leaf = (dw / 2 - 3) / 2
        local_offset = Vector((-side * half_leaf, 0, 0))
        leaf.location = Vector((hx + side * (dw / 2 - 3), front - 6, ground + 3 + (dh - 4) / 2)) + leaf.rotation_euler.to_matrix() @ local_offset
    box("Entry_ShallowThreshold", (dw + 48, 46, 6),
        (hx, front - 20, ground + 3), "stone", bevel=2)

    floor2z = ground + first_h
    box("Floor2_BearingShell", (bw, bd, second_h), (hx, hy, floor2z + second_h / 2), "plaster", bevel=3)
    box("Floor2_ContinuousFloorBand", (bw + 10, bd + 10, 17), (hx, hy, floor2z + 3), "timber", bevel=2)
    box("Floor2_EavesBand", (bw + 12, bd + 12, 17), (hx, hy, floor2z + second_h - 3), "timber", bevel=2)
    for x in (left + 4, hx, right - 4):
        box(f"Floor2_FrontPost_{x}", (14, 12, second_h), (x, front - 5, floor2z + second_h / 2))
    for y in (front + 5, hy, back - 5):
        box(f"Floor2_LeftPost_{y}", (12, 14, second_h), (left - 5, y, floor2z + second_h / 2))
    for side in (-1, 1):
        kit.shutter_window(collection, root, prefix + f"Upper_FrontWindow_{side}",
                           (hx + side * 110, front - 13, floor2z + 70), mats["glass"], mats["timber"], mats["iron"], scale=.95)
        kit.shutter_window(collection, root, prefix + f"Ground_FrontWindow_{side}",
                           (hx + side * 157, front - 13, ground + 103), mats["glass"], mats["timber"], mats["iron"], scale=.73)
    kit.shutter_window(collection, root, prefix + "Upper_SideWindow",
                       (left - 12, hy + 115, floor2z + 70), mats["glass"], mats["timber"], mats["iron"], orientation="side", scale=1)
    rw, rd, rh = dims["mainRoof"]
    roof_z = floor2z + second_h
    kit.gabled_prism(collection, root, prefix + "Main_SlateRoof", rw, rd, rh,
                     (hx, hy, roof_z), mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, prefix + "Main_SlateCourse", rw, rd, rh,
                  roof_z, mats["roof"], rows=8, center=(hx, hy))
    box("Main_RidgeCap", (rw + 6, 15, 14), (hx, hy, roof_z + rh + 4), "iron", bevel=2)
    for side in (-1, 1):
        beam(f"Gable_TimberEdge_{side}", (left - 24, hy + side * rd / 2, roof_z),
             (left - 24, hy, roof_z + rh), 11)
    beam("Gable_CentralPost", (left - 24, hy, roof_z), (left - 24, hy, roof_z + rh), 10)

    # Low attached loading shelter. No extra tower or separate mine entrance.
    cx, cy, canopy_h = dims["canopyCenter"]
    cw, cd, ct = dims["canopy"]
    slope = dims["canopySlopeDegrees"]
    canopy_z = ground + canopy_h
    box("LoadingBay_LeanToRoof", (cw, cd, ct), (cx, cy, canopy_z), "roof", (0, -slope, 0), bevel=3)
    for row in range(5):
        xx = cx - cw / 2 + (row + .5) * cw / 5
        zz = canopy_z + math.sin(math.radians(slope)) * (xx - cx) + ct / 2
        box(f"LoadingBay_RoofCourse_{row}", (cw / 5 + 5, cd, 4), (xx, cy, zz), "roof", (0, -slope, 0), bevel=.6)
    outer_x = cx - cw / 2 + 22
    outer_top = canopy_z + math.tan(math.radians(slope)) * (outer_x - cx) - ct / 2
    for index, y in enumerate((cy - cd / 2 + 18, cy + cd / 2 - 18)):
        box(f"LoadingBay_OuterPost_{index}", (20, 20, outer_top - ground), (outer_x, y, (ground + outer_top) / 2), bevel=2)
        box(f"LoadingBay_PostShoe_{index}", (25, 25, 27), (outer_x, y, ground + 13.5), "iron")
        beam(f"LoadingBay_KneeBrace_{index}", (outer_x, y, outer_top - 70), (outer_x + 62, y, outer_top + 4), 12)
        beam(f"LoadingBay_Rafter_{index}", (outer_x - 12, y, outer_top), (left + 8, y, canopy_z + 28), 14)
    beam("LoadingBay_OuterHeader", (outer_x, cy - cd / 2, outer_top), (outer_x, cy + cd / 2, outer_top), 19)

    # Rail and open cart are local building components, no outside road baked in.
    cartx, carty = dims["cartCenter"]
    gauge, rail_length, rail_y = dims["railGauge"], dims["railLength"], dims["railCenterY"]
    for index in range(12):
        y = rail_y - rail_length / 2 + (index + .5) * rail_length / 12
        box(f"LoadingTrack_Sleeper_{index}", (gauge + 60, 16, 7), (cartx, y, ground + 3.5), "timber")
    for side in (-1, 1):
        box(f"LoadingTrack_Rail_{side}", (9, rail_length, 9), (cartx + side * gauge / 2, rail_y, ground + 9), "steel", bevel=1)
    cart_w, cart_d, cart_h = dims["cartSize"]
    wheel_r, wheel_z = 22, ground + 13.5 + 22
    for yi, dy in enumerate((-cart_d * .32, cart_d * .32)):
        cyl(f"OreCart_Axle_{yi}", 6, gauge + 22, (cartx, carty + dy, wheel_z), rotation=(0, 90, 0))
        for side in (-1, 1):
            cyl(f"OreCart_Wheel_{yi}_{side}", wheel_r, 11,
                (cartx + side * gauge / 2, carty + dy, wheel_z), rotation=(0, 90, 0))
            cyl(f"OreCart_WheelHub_{yi}_{side}", 8, 14,
                (cartx + side * gauge / 2, carty + dy, wheel_z), "brass", rotation=(0, 90, 0))
    cart_bottom = wheel_z + 19
    box("OreCart_Chassis", (cart_w - 10, cart_d, 12), (cartx, carty, cart_bottom), "iron")
    # Four tapered panels leave the hopper top genuinely open.
    for side in (-1, 1):
        box(f"OreCart_Side_{side}", (7, cart_d, cart_h),
            (cartx + side * (cart_w / 2 - 7), carty, cart_bottom + cart_h / 2), "iron", (0, side * 9, 0))
        box(f"OreCart_End_{side}", (cart_w - 4, 7, cart_h),
            (cartx, carty + side * (cart_d / 2 - 6), cart_bottom + cart_h / 2), "iron", (-side * 9, 0, 0))
        box(f"OreCart_Rim_{side}", (10, cart_d + 15, 8),
            (cartx + side * (cart_w / 2 - 2), carty, cart_bottom + cart_h - 2), "steel")
    for index, (dx, dy, h) in enumerate(((-29, -42, 27), (19, -37, 32), (-22, 5, 37), (28, 15, 29), (-20, 48, 25), (20, 47, 30))):
        kit.rough_boulder(collection, root, prefix + f"OreCart_GrayOre_{index}",
                          (42, 43, h), (cartx + dx, carty + dy, cart_bottom + cart_h - 12),
                          mats["stone"], rotation=(9 * index, 13, 23 * index), subdivisions=1)
        if index in (0, 2, 4):
            kit.rough_boulder(collection, root, prefix + f"OreCart_PurpleInlay_{index}",
                              (20, 16, 8), (cartx + dx - 2, carty + dy - 4, cart_bottom + cart_h + h * .25),
                              mats["ore"], rotation=(8, 15, index * 20), subdivisions=1)
    wx, wy, wh = dims["winchCenter"]
    wz = ground + wh
    for side in (-1, 1):
        box(f"HaulWinch_Support_{side}", (17, 45, wh), (wx + side * 61, wy, ground + wh / 2), "timber")
        cyl(f"HaulWinch_Flange_{side}", 32, 8, (wx + side * 43, wy, wz), rotation=(0, 90, 0))
    cyl("HaulWinch_Drum", 23, 80, (wx, wy, wz), "timber", rotation=(0, 90, 0))
    kit.gear(collection, root, prefix + "HaulWinch_CrankGear", 38,
             (wx - 70, wy, wz), mats["iron"], axis="X", teeth=10)
    beam("HaulWinch_CrankArm", (wx - 80, wy, wz), (wx - 80, wy - 30, wz + 14), 7, "brass")
    cyl("HaulWinch_CrankGrip", 5, 28, (wx - 91, wy - 30, wz + 14), "timber", rotation=(0, 90, 0))
    beam("HaulWinch_Cable", (wx, wy - 23, wz), (cartx, carty + cart_d / 2, cart_bottom + 8), 3, "iron")

    # Guild identity is modeled geometry: two crossed picks above the doorway.
    sign_y, sign_z = front - 22, ground + 181
    cyl("GuildSeal_Backplate", dims["emblemRadius"], 9, (hx, sign_y, sign_z), "banner", rotation=(90, 0, 0), vertices=12)
    kit.torus_ring(collection, root, prefix + "GuildSeal_Border", dims["emblemRadius"] - 3, 3.2,
                   (hx, sign_y - 6, sign_z), mats["brass"], rotation=(90, 0, 0), major_segments=24, minor_segments=6)
    for index, angle in enumerate((-42, 42)):
        pick = bpy.data.objects.new(prefix + f"GuildSeal_Pick_{index}", None)
        collection.objects.link(pick)
        pick.parent = root
        pick.location = (hx, sign_y - 12 - index * 3, sign_z)
        pick.rotation_euler.y = math.radians(angle)
        box(f"GuildSeal_PickHandle_{index}", (7, 6, 83), (0, 0, -7), "brass", parent=pick)
        profile = [(-33, 14), (-18, 29), (0, 33), (18, 28), (33, 13), (17, 20), (0, 24), (-17, 21)]
        points = [(x, y, z) for y in (-4, 4) for x, z in profile]
        n = len(profile)
        faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
        faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        head = guild_mesh(collection, pick, prefix + f"GuildSeal_PickHead_{index}", points, faces, mats["steel"])
        kit.bevel(head, .8, 2)
    # Short pennant fixed to masonry, restrained purple rather than a glowing crystal tower.
    banner_y, banner_z = hy, roof_z + 48
    box("GuildBanner_WallMount", (32, 9, 8), (left - 30, banner_y, banner_z + 44), "iron")
    profile = [(left - 37, banner_y - 23, banner_z + 39), (left - 37, banner_y + 23, banner_z + 39),
               (left - 37, banner_y + 23, banner_z - 30), (left - 37, banner_y, banner_z - 49),
               (left - 37, banner_y - 23, banner_z - 30)]
    banner = guild_mesh(collection, root, prefix + "GuildBanner_Cloth", profile, [tuple(range(5))], mats["banner"])
    solid = banner.modifiers.new("EditableClothThickness", "SOLIDIFY")
    solid.thickness = 2
    for side in (-1, 1):
        kit.lantern(collection, root, prefix + f"Entry_Lantern_{side}",
                    (hx + side * 85, front - 25, ground + 150), mats["iron"], mats["glass"])
    kit.workbench(collection, root, prefix + "AssayBench", (10, -280, ground), mats["timber"], mats["iron"])
    for index, dx in enumerate((-21, 12, 31)):
        kit.rough_boulder(collection, root, prefix + f"AssayBench_Sample_{index}",
                          (18, 15, 13), (10 + dx, -280, ground + 64), mats["ore" if index == 1 else "stone"], subdivisions=1)

    root["asset_status"] = "model_candidate_awaiting_user_review"
    root["proposed_footprint_cells"] = 4
    root["intended_plane"] = "scene12"
    root["runtime_integration_active"] = False
    root["entry_axis"] = "local negative Y"
    root["foundation_style"] = "fieldstone"
    root["model_floors"] = 2
    return root


if __name__ == "__main__":
    manifest_path = Path(pack.parse_args()[0])
    pack.BUILDERS["mining_guild"] = build_mining_guild
    pack.main()
    from bpy_extras.object_utils import world_to_camera_view
    root = bpy.data.objects["MINING_GUILD_ROOT_ROT_Z_44_8"]
    scene = bpy.context.scene
    source = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    building = source["buildings"]["mining_guild"]
    fw, fd, _ = building["dimensions"]["foundation"]
    camera_spec = {**source["camera"], **building.get("cameraOverrides", {})}
    corners = []
    for point in ((-fw/2, -fd/2, 0), (fw/2, -fd/2, 0), (fw/2, fd/2, 0), (-fw/2, fd/2, 0)):
        p = world_to_camera_view(scene, scene.camera, root.matrix_world @ Vector(point))
        corners.append([round(p.x * scene.render.resolution_x, 3), round((1 - p.y) * scene.render.resolution_y, 3)])
    (OUT / "model-metadata.json").write_text(json.dumps({
        "assetId": "mining_guild", "status": "model_candidate_awaiting_user_review",
        "nativePreview": "mining_guild_model_approval_preview.png",
        "bodyDepth": "mining_guild_body_depth.png", "bodyDepthIncludesFoundation": True,
        "proposedFootprintCells": building["footprintCells"], "foundationCornersPx": corners,
        "rootRotationZ": camera_spec["buildingRotationZ"], "cameraElevation": camera_spec["elevation"],
        "objectCount": len(root.children_recursive), "runtimeInstalled": False,
        "aiGenerationStarted": False
    }, indent=2), encoding="utf-8")
