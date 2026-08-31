#!/usr/bin/env python3
"""Three editable civic eras on one 4x4 foundation; candidate assets only."""
import importlib.util
import math
from pathlib import Path

PACK_PATH = Path(__file__).with_name("settlement-building-pack-blender.py")
MODULE = importlib.util.spec_from_file_location("city_hall_settlement_pack", PACK_PATH)
pack = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(pack)
kit, bpy = pack.kit, pack.bpy


def build_city_hall(spec):
    tier = int(spec["level"])
    collection, root, mats = pack.common_context(spec["assetId"], spec)
    prefix = f"CityHallLV{tier}"
    palette = dict(spec["palette"])
    palette.update(spec.get("paletteOverrides", {}))
    for key, settings in spec["materialFinishes"].items():
        color = kit.rgba(palette[key])
        noise = None
        if settings.get("bump", 0):
            noise = {"scale": 3.0, "detail": 1, "bump": settings["bump"],
                     "dark": tuple(c * .94 for c in color[:3]) + (1,),
                     "light": tuple(min(1, c * 1.04) for c in color[:3]) + (1,)}
        mats[key] = kit.material(prefix + "_MAT_" + key, color,
                                roughness=settings["roughness"],
                                metallic=settings.get("metallic", 0), noise=noise)

    def box(name, size, position, mat, rotation=(0, 0, 0), bevel=1.3):
        return kit.box(collection, root, prefix + "_" + name, size, position,
                       mats[mat], rotation=rotation, bevel_width=bevel)

    def cylinder(name, radius, depth, position, mat, rotation=(0, 0, 0), vertices=32):
        return kit.cylinder(collection, root, prefix + "_" + name, radius, depth,
                            position, mats[mat], rotation=rotation, vertices=vertices)

    def ring(name, radius, thickness, position, mat, rotation=(90, 0, 0)):
        return kit.torus_ring(collection, root, prefix + "_" + name, radius,
                              thickness, position, mats[mat], rotation=rotation,
                              major_segments=40, minor_segments=8)

    def window(name, position, width, height, side=False, divisions=1):
        kit.framed_glass_panel(collection, root, prefix + "_" + name, position,
                               width, height, mats["glass"],
                               mats["timber" if tier < 3 else "steel"], mats["stone"],
                               orientation="side" if side else "front",
                               vertical_divisions=divisions, horizontal_divisions=2,
                               depth=4)

    def crest(name, x, y, z, radius):
        # Shared fictional civic emblem: three columns and a roof, no lettering.
        cylinder(name + "_Backplate", radius, 4, (x, y, z), "banner", (90, 0, 0))
        ring(name + "_Border", radius * .93, 1.5, (x, y - 3, z), "brass")
        for j in (-1, 0, 1):
            box(name + f"_Column_{j}", (radius * .15, 3, radius * .76),
                (x + j * radius * .4, y - 5, z - radius * .03), "brass", bevel=.4)
        box(name + "_Lintel", (radius * 1.36, 3, radius * .14),
            (x, y - 5, z + radius * .43), "brass", bevel=.4)
        box(name + "_Base", (radius * 1.4, 3, radius * .14),
            (x, y - 5, z - radius * .48), "brass", bevel=.4)

    def column(name, x, y, bottom, height, radius=8):
        box(name + "_Plinth", (radius * 2.7, radius * 2.7, 6),
            (x, y, bottom + 3), "stone")
        cylinder(name + "_Shaft", radius, height - 14,
                 (x, y, bottom + height / 2), "plaster")
        cylinder(name + "_Foot", radius * 1.25, 5,
                 (x, y, bottom + 8), "stone")
        box(name + "_Capital", (radius * 2.8, radius * 2.8, 7),
            (x, y, bottom + height - 3.5), "stone")

    def arch(name, x, y, bottom, width, height, trim=5):
        # Attached open stone arch assembled as named side piers and a ring mesh.
        radius = width / 2
        spring = bottom + height - radius
        for side in (-1, 1):
            box(name + f"_Pier_{side}", (trim, 10, spring - bottom),
                (x + side * (radius + trim / 2), y, (bottom + spring) / 2), "stone")
        vertices, faces = [], []
        for d in (-5, 5):
            for r in (radius, radius + trim):
                for i in range(17):
                    angle = i * math.pi / 16
                    vertices.append((x + r * math.cos(angle), y + d,
                                     spring + r * math.sin(angle)))
        for i in range(16):
            faces.extend([(i, i + 1, 18 + i, 17 + i),
                          (34 + i, 51 + i, 52 + i, 35 + i),
                          (i, 34 + i, 35 + i, i + 1),
                          (17 + i, 18 + i, 52 + i, 51 + i)])
        faces.extend([(0, 17, 51, 34), (16, 50, 67, 33)])
        data = bpy.data.meshes.new(prefix + "_" + name + "_ArchMesh")
        data.from_pydata(vertices, [], faces)
        data.materials.append(mats["stone"])
        obj = bpy.data.objects.new(prefix + "_" + name + "_Arch", data)
        collection.objects.link(obj)
        obj.parent = root
        kit.bevel(obj, .8, 2)

    dims = spec["dimensions"]
    fw, fd, ground = dims["foundation"]
    floor = ground + dims["floorRise"]
    width, depth, height = dims["body"]
    cy = dims["bodyCenterY"]
    front, side, top = cy - depth / 2, width / 2, floor + height
    foundation = "concrete" if tier == 3 else "foundation"
    box("Foundation_4x4", (fw, fd, ground), (0, 0, ground / 2), foundation, bevel=3)
    box("Foundation_Inset", (fw - 12, fd - 12, 3), (0, 0, ground + 1.5), foundation)
    # The model never paints roads beyond its logical boundary.
    for i in range(4):
        box(f"Forecourt_Slab_{i}", (fw / 4 - 3, 48, 2),
            (-fw * .375 + i * fw / 4, -fd / 2 + 31, ground + 3), "stone")
    for side_sign in (-1, 1):
        for i in range(5):
            if tier < 3:
                pos = -fw * .4 + i * fw * .2
                box(f"Foundation_EdgeX_{side_sign}_{i}", (fw * .2 - 3, 8, 10),
                    (pos, side_sign * (fd / 2 - 4), ground - 5), "stone")
                box(f"Foundation_EdgeY_{side_sign}_{i}", (8, fd * .2 - 3, 10),
                    (side_sign * (fw / 2 - 4), pos, ground - 5), "stone")
    stairs_w, stairs_d, stair_count = dims["stairs"]
    portico_front = dims["porticoFrontY"]
    for i in range(stair_count):
        step_height = dims["floorRise"] * (i + 1) / stair_count
        box(f"Entry_Step_{i + 1}", (stairs_w - i * 5, stairs_d / stair_count + 1, step_height),
            (0, portico_front - stairs_d + (i + .5) * stairs_d / stair_count,
             ground + step_height / 2), "stone")

    if tier == 1:
        box("CouncilHall_BearingShell", (width, depth, height), (0, cy, floor + height / 2), "plaster")
        box("CouncilHall_StoneSkirt", (width + 5, depth + 5, 19), (0, cy, floor + 9.5), "stone")
        box("CouncilHall_Cornice", (width + 15, depth + 15, 10), (0, cy, top), "stone")
        rw, rd, rh = dims["roof"]
        kit.gabled_prism(collection, root, prefix + "_MainRoof", rw, rd, rh,
                         (0, cy, top + 6), mats["plaster"], mats["roof"])
        kit.roof_rows(collection, root, prefix + "_RoofCourses", rw, rd, rh,
                      top + 6, mats["roof"], rows=5, center=(0, cy))
        pw, ph = dims["portico"]
        py = (front + portico_front) / 2
        box("Portico_Landing", (pw + 20, front - portico_front + 6, 8),
            (0, py, floor - 4), "stone")
        for j in range(6):
            column(f"Portico_Column_{j + 1}", -pw * .44 + j * pw * .176,
                   portico_front + 9, floor, ph, 7.5)
        box("Portico_Entablature", (pw + 18, front - portico_front + 12, 13),
            (0, py, floor + ph + 5), "stone")
        pediment = kit.gabled_prism(collection, root, prefix + "_CivicPediment",
                                   front - portico_front + 14, pw + 22, 36,
                                   (0, py, floor + ph + 12), mats["plaster"], mats["roof"])
        pediment.rotation_euler.z = math.radians(90)
        crest("CivicSeal", 0, portico_front - 3, floor + ph + 25, 13)
        box("Door_Recess", (62, 4, 81), (0, front - 3, floor + 40), "interior")
        kit.double_doors(collection, root, prefix + "_CouncilDoors", (0, front - 10, floor),
                         58, 76, mats["timber"], mats["brass"], open_angle=22)
        for sx in (-1, 1):
            window(f"FrontWindow_{sx}", (sx * width * .36, front - 5, floor + 59), 28, 42)
            box(f"RecordsTablet_{sx}", (27, 5, 22), (sx * 67, front - 6, floor + 48), "stone")
        for sx in (-1, 1):
            for j in range(4):
                yy = cy - depth * .34 + j * depth * .225
                window(f"SideWindow_{sx}_{j}", (sx * (side + 4), yy, floor + 63), 29, 49, side=True)
                box(f"SidePilaster_{sx}_{j}", (7, 11, height - 20),
                    (sx * (side + 3), yy + 24, floor + height / 2), "stone")

    elif tier == 2:
        storey = dims["storeyHeights"]
        kit.stacked_bearing_shells(collection, root, prefix + "_CouncilStorey",
                                   [(width, depth, h) for h in storey],
                                   [mats["stone"], mats["plaster"]],
                                   base_z=floor, band_mat=mats["stone"], band_height=8)
        # Shared shell helper is centered at the origin; move all its named parts as one family.
        for obj in tuple(root.children):
            if obj.name.startswith(prefix + "_CouncilStorey"):
                obj.location.y += cy
        rw, rd, rh = dims["roof"]
        kit.gabled_prism(collection, root, prefix + "_CouncilRoof", rw, rd, rh,
                         (0, cy, top + 5), mats["plaster"], mats["roof"])
        kit.roof_rows(collection, root, prefix + "_RoofCourses", rw, rd, rh,
                      top + 5, mats["roof"], rows=5, center=(0, cy))
        pw, ph = dims["portico"]
        box("Arcade_Landing", (pw + 16, front - portico_front + 6, 8),
            (0, (front + portico_front) / 2, floor - 4), "stone")
        for j, xx in enumerate((-105, -35, 35, 105)):
            arch(f"PublicArcade_{j + 1}", xx, portico_front + 8, floor, 56, ph, 6)
        box("Arcade_UpperGallery", (pw + 17, front - portico_front + 16, 12),
            (0, (front + portico_front) / 2, floor + ph + 8), "stone")
        for xx in (-111, -61, 61, 111):
            kit.shutter_window(collection, root, prefix + f"_UpperWindow_{xx}",
                               (xx, front - 7, floor + storey[0] + 40),
                               mats["glass"], mats["timber"], mats["iron"], scale=.66)
        for sx in (-1, 1):
            for j in range(4):
                yy = cy - depth * .34 + j * depth * .22
                window(f"SideWindow_{sx}_{j}", (sx * (side + 4), yy, floor + storey[0] + 39),
                       29, 42, side=True)
                window(f"RecordsOfficeWindow_{sx}_{j}", (sx * (side + 4), yy, floor + 43),
                       23, 33, side=True)
        tw, td, th = dims["tower"]
        ty = dims["towerCenterY"]
        box("ClockTower_BearingShell", (tw, td, th), (0, ty, floor + th / 2), "plaster")
        for sx in (-1, 1):
            box(f"ClockTower_Quoin_{sx}", (9, td + 4, th),
                (sx * (tw / 2 - 4), ty, floor + th / 2), "stone")
        for z in (floor + 94, floor + 182, floor + th - 6):
            box(f"ClockTower_Band_{int(z)}", (tw + 10, td + 10, 8), (0, ty, z), "stone")
        clock_z, clock_y = floor + th - 45, ty - td / 2 - 5
        cylinder("Clock_Face", 25, 3, (0, clock_y, clock_z), "stone", (90, 0, 0))
        ring("Clock_Rim", 26, 2, (0, clock_y - 2, clock_z), "brass")
        for j in range(12):
            a = j * math.tau / 12
            box(f"Clock_Tick_{j}", (2.2, 2, 4.5),
                (math.sin(a) * 21, clock_y - 4, clock_z + math.cos(a) * 21),
                "iron", rotation=(0, math.degrees(a), 0), bevel=.2)
        box("Clock_MinuteHand", (2, 3, 18), (0, clock_y - 5, clock_z + 7), "iron", bevel=.2)
        box("Clock_HourHand", (13, 3, 3), (5, clock_y - 6, clock_z), "iron", bevel=.2)
        kit.gabled_prism(collection, root, prefix + "_ClockTowerCap", tw + 19, td + 19,
                         dims["towerRoofHeight"], (0, ty, floor + th), mats["stone"], mats["roof"])
        cylinder("BellTower_Finial", 2.5, 20, (0, ty, floor + th + dims["towerRoofHeight"] + 6), "brass")
        crest("CivicSeal", 0, ty - td / 2 - 6, floor + 154, 20)
        box("Door_Recess", (51, 4, 79), (0, ty - td / 2 - 3, floor + 39), "interior")
        kit.double_doors(collection, root, prefix + "_CouncilDoors", (0, ty - td / 2 - 10, floor),
                         47, 76, mats["timber"], mats["iron"], open_angle=20)
        for sx in (-1, 1):
            box(f"CivicBanner_{sx}", (21, 3, 62), (sx * 82, front - 10, floor + 137), "banner")
            kit.lantern(collection, root, prefix + f"_EntryLantern_{sx}",
                        (sx * 38, portico_front + 18, floor + 62), mats["iron"], mats["glass"])

    else:
        storey = dims["storeyHeights"]
        for index, sh in enumerate(storey):
            zbase = floor + sum(storey[:index])
            box(f"Administration_Floor_{index + 1}", (width, depth, sh),
                (0, cy, zbase + sh / 2), "concrete", bevel=2.5)
            box(f"FloorBand_{index + 1}", (width + 9, depth + 9, 8),
                (0, cy, zbase + sh - 4), "stone")
            for sx in (-1, 1):
                window(f"FrontWindow_{index}_{sx}", (sx * 107, front - 5, zbase + sh * .53),
                       73, 29, divisions=3)
            for sx in (-1, 1):
                for j in range(3):
                    window(f"SideWindow_{index}_{sx}_{j}", (sx * (side + 5), cy - 76 + j * 76, zbase + sh * .53),
                           48, 29, side=True, divisions=2)
        pw, ph = dims["portico"]
        box("Atrium_FrontGlazing", (89, 6, height - 21),
            (0, front - 9, floor + (height - 21) / 2), "glass")
        for xx in (-45, -15, 15, 45):
            box(f"Atrium_Mullion_{xx}", (3.5, 7, height - 18),
                (xx, front - 13, floor + (height - 18) / 2), "steel", bevel=.5)
        for z in (floor + 50, floor + 103, floor + 155):
            box(f"Atrium_Transom_{int(z)}", (92, 7, 4), (0, front - 13, z), "steel", bevel=.5)
        box("PublicLobby_Landing", (pw + 12, front - portico_front + 14, 8),
            (0, (front + portico_front) / 2, floor - 4), "concrete")
        for xx in (-77, -48, 48, 77):
            box(f"CivicPortico_Pier_{xx}", (10, 15, ph),
                (xx, portico_front + 8, floor + ph / 2), "stone")
        box("PublicLobby_Canopy", (pw + 16, front - portico_front + 25, 11),
            (0, (front + portico_front) / 2, floor + ph + 5), "concrete", bevel=2)
        window("PublicGlassDoors", (0, portico_front + 15, floor + 27), 67, 52, divisions=2)
        box("Roof_Parapet_Front", (width + 10, 10, 17), (0, front, top + 8), "stone")
        box("Roof_Parapet_Back", (width + 10, 10, 17), (0, cy + depth / 2, top + 8), "stone")
        for sx in (-1, 1):
            box(f"Roof_Parapet_Side_{sx}", (10, depth, 17), (sx * side, cy, top + 8), "stone")
        crest("CivicSeal", 0, front - 16, top - 19, 18)
        roof_pavilion = dims["roofPavilion"]
        box("CouncilChamber_RoofPavilion", roof_pavilion,
            (0, cy + 17, top + roof_pavilion[2] / 2), "concrete", bevel=3)
        box("CouncilChamber_Cap", (roof_pavilion[0] + 10, roof_pavilion[1] + 10, 7),
            (0, cy + 17, top + roof_pavilion[2]), "stone")
        window("CouncilChamber_Clerestory", (0, cy + 17 - roof_pavilion[1] / 2 - 4, top + 23),
               roof_pavilion[0] - 25, 18, divisions=4)
        kit.solar_panel_array(collection, root, prefix + "_RoofSolar", (-102, cy + 26, top + 12),
                              2, 1, (42, 38, 2), mats["glass"], mats["steel"],
                              tilt_degrees=14, support_height=6, support_mat=mats["steel"])
        box("Roof_Ventilation", (35, 52, 15), (107, cy + 57, top + 12), "steel")
        for j in range(4):
            box(f"Ventilation_Louvre_{j}", (29, 2, 2),
                (107, cy + 42 + j * 8, top + 20), "iron", bevel=.2)
        for sx in (-1, 1):
            box(f"Forecourt_Planter_{sx}", (35, 30, 17), (sx * 141, -159, ground + 9), "concrete")
            box(f"Forecourt_Plant_{sx}", (29, 24, 12), (sx * 141, -159, ground + 22), "foliage", bevel=5)

    root["asset_status"] = "model_candidate_awaiting_user_review"
    root["building_family"] = "city_hall"
    root["footprint_cells"] = 4
    root["logical_ground_projection"] = "512x256; final tier art calibrated independently"
    root["technology_visual_tier"] = tier
    root["entry_axis"] = "local negative Y; same origin across all three eras"
    return root


if __name__ == "__main__":
    for asset_id in ("city_hall_lv1", "city_hall_lv2", "city_hall_lv3"):
        pack.BUILDERS[asset_id] = build_city_hall
    pack.main()
