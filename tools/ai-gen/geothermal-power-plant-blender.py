#!/usr/bin/env python3
"""Editable World-122 geothermal candidate; no runtime asset installation."""
import importlib.util
import math
from pathlib import Path

PACK_PATH = Path(__file__).with_name("settlement-building-pack-blender.py")
MODULE = importlib.util.spec_from_file_location("geothermal_settlement_pack", PACK_PATH)
pack = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(pack)
kit, bpy, Vector = pack.kit, pack.bpy, pack.mathutils.Vector


def geothermal_pipe_run(collection, root, name, points, radius, mat):
    """One editable round pipe mesh; points are in building-local XYZ units."""
    points = [Vector(point) for point in points]
    samples = [points[0]]
    for index in range(1, len(points) - 1):
        center = points[index]
        before, after = points[index - 1] - center, points[index + 1] - center
        bend = min(radius * 2.7, before.length / 3, after.length / 3)
        start = center + before.normalized() * bend
        end = center + after.normalized() * bend
        for step in range(9):
            t = step / 8
            samples.append((1 - t) ** 2 * start + 2 * (1 - t) * t * center + t * t * end)
    samples.append(points[-1])
    curve = bpy.data.curves.new(name + "_Curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    spline.points.add(len(samples) - 1)
    for vertex, position in zip(spline.points, samples):
        vertex.co = (*position, 1)
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    obj.parent = root
    curve.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def build_geothermal_power_plant(spec):
    collection, root, mats = pack.common_context(spec["assetId"], spec)
    prefix = "GeothermalPlant_"
    dims = spec["dimensions"]
    # Clear material blocks first; the candidate is not an AI-textured final asset.
    for key, color in spec["palette"].items():
        metallic = .58 if key in ("iron", "brass", "hotPipe", "coldPipe", "machine") else 0
        roughness = .46 if metallic else .84
        mats[key] = kit.material(prefix + "MAT_" + key, kit.rgba(color),
                                 roughness=roughness, metallic=metallic)

    def box(name, size, position, material="iron", rotation=(0, 0, 0), bevel=2):
        return kit.box(collection, root, prefix + name, size, position,
                       mats[material], rotation=rotation, bevel_width=bevel)

    def cyl(name, radius, depth, position, material="iron", rotation=(0, 0, 0), vertices=40):
        obj = kit.cylinder(collection, root, prefix + name, radius, depth, position,
                            mats[material], rotation=rotation, vertices=vertices,
                            bevel_width=1.4)
        for polygon in obj.data.polygons:
            polygon.use_smooth = len(polygon.vertices) == 4
        return obj

    def ring(name, radius, thickness, position, material="brass", rotation=(0, 0, 0)):
        return kit.torus_ring(collection, root, prefix + name, radius, thickness,
                              position, mats[material], rotation=rotation,
                              major_segments=40, minor_segments=8)

    def pipe(name, points, radius, material):
        return geothermal_pipe_run(collection, root, prefix + name, points, radius, mats[material])

    def window(name, position, width, height, orientation="front", divisions=3):
        kit.framed_glass_panel(collection, root, prefix + name, position, width,
                               height, mats["glass"], mats["iron"], mats["stone"],
                               orientation=orientation, vertical_divisions=divisions,
                               horizontal_divisions=1, ornaments=False, depth=5)

    def handwheel(name, x, y, z, radius=22):
        cyl(name + "_Stem", 5, 28, (x, y, z - 16), "brass")
        ring(name + "_Rim", radius, 3.6, (x, y, z))
        for angle in (0, 60, 120):
            box(name + f"_Spoke_{angle}", (radius * 1.85, 4, 4), (x, y, z),
                "brass", (0, 0, angle), bevel=.6)
        cyl(name + "_Hub", 7, 6, (x, y, z), "brass")

    fw, fd, fh = dims["foundation"]
    inset, pad_h = dims["padInset"], dims["padHeight"]
    ground = fh + pad_h
    box("Foundation_Base", (fw, fd, fh), (0, 0, fh / 2), "foundation", bevel=7)
    box("InsetServicePad", (fw - inset, fd - inset, pad_h),
        (0, 0, fh + pad_h / 2), "stone", bevel=4)
    for xx in (-fw / 2 + 22, fw / 2 - 22):
        box(f"Foundation_Edge_{int(xx)}", (7, fd - 36, 4), (xx, 0, ground + 2), "plaster", bevel=1)
    # Internal work lanes are concrete, not world-road tiles or extra footprint.
    lane = dims["serviceLaneWidth"]
    box("ServiceLane_Front", (fw - 74, lane, 2), (0, -fd / 2 + 62, ground + 1), "plaster", bevel=1)
    box("ServiceLane_Cross", (584, lane, 2), (104, -20, ground + 1), "plaster", bevel=1)
    box("ServiceLane_Entry", (lane, 120, 2), (2, -236, ground + 1), "plaster", bevel=1)

    # Two grounded wellheads make production and reinjection visible as a pair.
    head_h, head_r, well_r = dims["wellHeadHeight"], dims["wellHeadRadius"], dims["wellRadius"]
    well_z = ground + 22 + head_h
    for name, position, color in (
        ("ProductionWell", dims["productionWellCenter"], "hotPipe"),
        ("ReinjectionWell", dims["reinjectionWellCenter"], "coldPipe"),
    ):
        x, y = position
        cyl(name + "_ConcreteSocket", well_r + 14, 16, (x, y, ground + 8), "foundation")
        cyl(name + "_SealedBorePlate", well_r, 13, (x, y, ground + 21), "iron")
        cyl(name + "_PressureHead", head_r, head_h, (x, y, ground + 22 + head_h / 2), color)
        for n, z in enumerate((ground + 34, well_z - 18)):
            cyl(name + f"_Flange_{n}", head_r + 12, 11, (x, y, z), "iron")
            for j in range(8):
                angle = j * math.tau / 8
                cyl(name + f"_Bolt_{n}_{j}", 3.6, 5,
                    (x + (head_r + 5) * math.cos(angle), y + (head_r + 5) * math.sin(angle), z + 7),
                    "brass", vertices=6)
        handwheel(name + "_IsolationValve", x, y, well_z + 30,
                  radius=dims.get("wellValveRadius", 26))
        cyl(name + "_GaugeCase", 15, 8, (x, y - head_r - 6, well_z - 26), "iron", (90, 0, 0))
        cyl(name + "_GaugeDial", 12, 3, (x, y - head_r - 11, well_z - 26), "plaster", (90, 0, 0))
        box(name + "_GaugePointer", (3, 3, 16), (x + 3, y - head_r - 13, well_z - 23),
            "iron", (0, -28, 0), bevel=.5)
        for sx in (-1, 1):
            box(name + f"_GuardPost_{sx}", (7, 7, 55), (x + sx * 63, y - 58, ground + 27.5), "warning")
        box(name + "_LowGuardRail", (132, 7, 7), (x, y - 58, ground + 51), "iron")

    # Exchanger is mounted on two saddle feet, not a chimney or combustion boiler.
    ex, ey, ez = dims["heatExchangerCenter"]
    er, el = dims["heatExchangerRadius"], dims["heatExchangerLength"]
    for side in (-1, 1):
        x = ex + side * el * .31
        box(f"HeatExchanger_Saddle_{side}", (29, er * 1.75, ez - ground),
            (x, ey, (ground + ez) / 2), "iron", bevel=4)
        box(f"HeatExchanger_Foot_{side}", (48, er * 1.95, 9), (x, ey, ground + 4.5), "foundation")
    exchanger_material = dims.get("exchangerShellMaterial", "machine")
    cyl("HeatExchanger_PressureShell", er, el, (ex, ey, ez), exchanger_material, (0, 90, 0))
    for side in (-1, 1):
        x = ex + side * el / 2
        cyl(f"HeatExchanger_EndFlange_{side}", er + 6, 11, (x, ey, ez), "iron", (0, 90, 0))
        cyl(f"HeatExchanger_EndCap_{side}", er - 5, 14, (x + side * 6, ey, ez), exchanger_material, (0, 90, 0))
        for j in range(8):
            angle = j * math.tau / 8
            cyl(f"HeatExchanger_EndBolt_{side}_{j}", 4, 5,
                (x + side * 8, ey + er * .88 * math.sin(angle), ez + er * .88 * math.cos(angle)),
                "brass", (0, 90, 0), vertices=6)
    for i, dx in enumerate((-el * .28, el * .28)):
        ring(f"HeatExchanger_Restraint_{i}", er + 1.5, 3.5, (ex + dx, ey, ez), "brass", (0, 90, 0))

    # Low turbine and generator are aligned and mechanically coupled.
    tx, ty, tz = dims["turbineCenter"]
    tr, tl = dims["turbineRadius"], dims["turbineLength"]
    gx, gy, gz = dims["generatorCenter"]
    gr, gl = dims["generatorRadius"], dims["generatorLength"]
    box("TurbineGenerator_CommonSkid", (435, 168, 16), (151, ty, ground + 8), "foundation", bevel=5)
    for name, x, y, z, radius, length in (
        ("Turbine", tx, ty, tz, tr, tl), ("Generator", gx, gy, gz, gr, gl),
    ):
        for side in (-1, 1):
            box(name + f"_Mount_{side}", (22, radius * 1.4, z - ground - 12),
                (x + side * length * .32, y, (z + ground + 12) / 2), "iron")
        cyl(name + "_Housing", radius, length, (x, y, z), "machine", (0, 90, 0))
        for side in (-1, 1):
            cyl(name + f"_EndRing_{side}", radius + 5, 10,
                (x + side * length / 2, y, z), "iron", (0, 90, 0))
        for j in range(5 if name == "Turbine" else 8):
            xoff = (j / (4 if name == "Turbine" else 7) - .5) * length * .76
            ring(name + f"_CoolingRib_{j}", radius + 1, 2.8,
                 (x + xoff, y, z), "stone" if name == "Turbine" else "iron", (0, 90, 0))
    coupling_start, coupling_end = tx + tl / 2, gx - gl / 2
    pipe("TurbineGenerator_Coupling", [(coupling_start, ty, tz), (coupling_end, gy, gz)], 15, "brass")
    box("Generator_TerminalBox", (54, 48, 25), (gx, gy, gz + gr + 10), "iron")
    box("Generator_Indicator", (29, 5, 10), (gx, gy - 26, gz + gr + 12), "coldPipe", bevel=1)

    # Rear control room: split walls create a genuine recessed open entrance.
    hx, hy = dims["controlHallCenter"]
    hw, hd, hh = dims["controlHall"]
    wall = dims["hallWallThickness"]
    door_w, door_h = dims["hallDoorWidth"], dims["hallDoorHeight"]
    left, right, front, back = hx - hw / 2, hx + hw / 2, hy - hd / 2, hy + hd / 2
    hall_base, door_x = ground + 12, hx + dims.get("hallDoorOffsetX", 56)
    box("ControlHall_Plinth", (hw + 17, hd + 17, 12), (hx, hy, ground + 6), "foundation", bevel=4)
    box("ControlHall_RearWall", (hw, wall, hh), (hx, back - wall / 2, hall_base + hh / 2), "plaster")
    for name, x in (("Left", left + wall / 2), ("Right", right - wall / 2)):
        box("ControlHall_" + name + "Wall", (wall, hd, hh), (x, hy, hall_base + hh / 2), "plaster")
    for name, a, b in (("FrontLeft", left, door_x - door_w / 2), ("FrontRight", door_x + door_w / 2, right)):
        box("ControlHall_" + name + "Pier", (b - a, wall, hh),
            ((a + b) / 2, front + wall / 2, hall_base + hh / 2), "plaster")
    box("ControlHall_DoorLintel", (door_w, wall, hh - door_h),
        (door_x, front + wall / 2, hall_base + door_h + (hh - door_h) / 2), "plaster")
    box("ControlHall_InteriorShadow", (door_w - 3, 5, door_h - 3),
        (door_x, front + dims.get("hallDoorRecess", 40), hall_base + door_h / 2), "iron")
    kit.double_doors(collection, root, prefix + "ControlHall_RecessedDoors",
                     (door_x, front + 12, hall_base), door_w - 4, door_h - 3,
                     mats["machine"], mats["iron"], open_angle=dims.get("hallDoorOpenAngle", 24))
    if dims.get("hallDoorHingeAccurate", False):
        # Keep the shared door leaves, but anchor this wider opening at its jambs.
        leaf_w = (door_w - 4) / 2 - 3
        angle = math.radians(dims["hallDoorOpenAngle"])
        for side in (-1, 1):
            leaf = bpy.data.objects[prefix + f"ControlHall_RecessedDoors_Leaf_{side:+d}"]
            leaf.location.x = door_x + side * ((door_w - 4) / 2 - leaf_w * math.cos(angle) / 2)
            leaf.location.y = front + 12 - leaf_w * math.sin(angle) / 2
    box("ControlHall_DoorThreshold", (door_w + 13, 50, 5), (door_x, front - 14, hall_base - 2), "stone")
    box("ControlHall_DoorCanopy", (door_w + 21, 50, 7), (door_x, front - 10, hall_base + door_h + 6), "iron")
    window("ControlHall_FrontGlazing", (left + 92, front - 4, hall_base + 71), 119, 45)
    window("ControlHall_LeftGlazing", (left - 4, hy + 22, hall_base + 88), 135, 49, "side", 4)
    for x in (left + 5, right - 5):
        box(f"ControlHall_FrontEdge_{int(x)}", (10, 15, hh), (x, front, hall_base + hh / 2), "iron")
    roof_z = hall_base + hh
    roof_h = dims["hallRoofHeight"]
    box("ControlHall_ContinuousFlatRoof", (hw + 19, hd + 19, roof_h),
        (hx, hy, roof_z + roof_h / 2), "roof", bevel=4)
    for y in (front - 5, back + 5):
        box(f"ControlHall_RoofEdge_{int(y)}", (hw + 28, 8, 15),
            (hx, y, roof_z + roof_h + 6), "stone")
    for x in (left - 5, right + 5):
        box(f"ControlHall_RoofSide_{int(x)}", (8, hd + 17, 15),
            (x, hy, roof_z + roof_h + 6), "stone")

    # Two roof-mounted closed condenser housings; grilles are fixed geometry.
    cw, cd, ch = dims["coolerSize"]
    for index, offset in enumerate(dims["coolerOffsetsX"]):
        x, y, bottom = hx + offset, hy + 12, roof_z + roof_h + 6
        name = f"RoofCondenser_{index}"
        for side in (-1, 1):
            box(name + f"_Rail_{side}", (cw + 8, 8, 10), (x, y + side * cd * .32, bottom + 5), "iron")
        box(name + "_Enclosure", (cw, cd, ch), (x, y, bottom + 9 + ch / 2), "machine", bevel=5)
        fan_z = bottom + ch + 10
        cyl(name + "_DarkFanRecess", 51, 4, (x, y, fan_z), "iron")
        for angle in (25, 115):
            box(name + f"_FanBlade_{angle}", (85, 18, 3), (x, y, fan_z + 3), "stone", (0, 0, angle))
        cyl(name + "_Hub", 12, 8, (x, y, fan_z + 6), "iron")
        for radius in (20, 34, 48, 53):
            ring(name + f"_GrilleRing_{radius}", radius, 1.6, (x, y, fan_z + 11), "iron")
        for angle in (0, 45, 90, 135):
            box(name + f"_GrilleSpoke_{angle}", (106, 2.3, 2.3), (x, y, fan_z + 12), "iron", (0, 0, angle), bevel=.4)
        for j in range(6):
            box(name + f"_FrontLouvre_{j}", (cw - 25, 3, 3),
                (x, y - cd / 2 - 1, bottom + 16 + j * 5), "iron", bevel=.4)

    # Primary supply and reinjection stay left; power-loop lines connect the skid.
    pr, sr = dims["primaryPipeRadius"], dims["secondaryPipeRadius"]
    px, py = dims["productionWellCenter"]
    ix, iy = dims["reinjectionWellCenter"]
    pipe("Primary_HotSupply", [(px, py, well_z - 37), (-226, py, well_z - 37),
         (-226, 59, well_z - 37), (-211, 59, ez), (-211, ey - er + 2, ez)], pr, "hotPipe")
    pipe("Primary_ColdReinjection", [(ex - el / 2 - 5, ey, ez), (-367, ey, ez),
         (-367, iy, well_z - 38), (ix, iy, well_z - 38)], pr, "coldPipe")
    pipe("Secondary_HotToTurbine", [(ex + el / 2 + 5, ey, ez), (-10, ey, ez),
         (-10, 5, ez), (-82, 5, ez), (-82, ty, tz), (tx - tl / 2 + 3, ty, tz)], sr, "hotPipe")
    pipe("Secondary_TurbineToCondenser", [(tx + 56, ty + tr - 4, tz), (tx + 56, -71, tz),
         (left - 20, -71, tz), (left - 20, hy - 54, roof_z + 22),
         (hx - 91, hy - 54, roof_z + 36)], sr, "coldPipe")
    pipe("Condenser_ReturnHeader", [(hx - 91, hy + 75, roof_z + 37),
         (hx - 91, back + 19, roof_z + 37), (hx + 91, back + 19, roof_z + 37),
         (hx + 91, hy + 75, roof_z + 37)], 9, "coldPipe")
    pipe("Condenser_ReturnToExchanger", [(hx - 91, back + 19, roof_z + 37),
         (left - 31, back + 19, roof_z + 37), (left - 31, back + 19, ez),
         (-108, back + 19, ez), (-108, ey + er - 3, ez)], 10, "coldPipe")
    pipe("Condenser_ForwardHeader", [(hx - 91, hy - 54, roof_z + 36),
         (hx - 91, front + 29, roof_z + 36), (hx + 91, front + 29, roof_z + 36),
         (hx + 91, hy - 54, roof_z + 36)], 9, "coldPipe")
    for index, (x, y, height) in enumerate(((-226, -78, well_z - 37), (-82, -93, tz),
                                           (-367, 129, ez))):
        box(f"PipeSupport_{index}_Foot", (30, 27, 7), (x, y, ground + 3.5), "foundation")
        box(f"PipeSupport_{index}_Stem", (7, 7, height - ground - 12),
            (x, y, (height + ground - 12) / 2), "iron")

    # Attached electrical switch cabinet and a wordless heat-source emblem.
    switch_x = left + dims.get("switchgearOffsetFromLeft", 48)
    box("Switchgear_Cabinet", (65, 33, 86), (switch_x, front - 19, hall_base + 43), "iron", bevel=4)
    box("Switchgear_ControlFace", (48, 3, 53), (switch_x, front - 37, hall_base + 49), "machine")
    box("Switchgear_StatusWindow", (29, 3, 11), (switch_x, front - 40, hall_base + 65), "glass")
    pipe("Generator_CableConduit", [(gx, gy, gz + gr + 22), (gx + 47, gy, gz + gr + 22),
         (gx + 47, -53, ground + 12), (switch_x, -53, ground + 12),
         (switch_x, front - 21, hall_base + 12)], 5, "iron")
    badge_x = hx + dims.get("badgeOffsetX", -20)
    badge_z = hall_base + dims.get("badgeOffsetZ", 137)
    box("HeatEmblem_Backplate", (78, 6, 52), (badge_x, front - 6, badge_z), "iron", bevel=5)
    for index, dx in enumerate((-23, 0, 23)):
        pipe(f"HeatEmblem_Wave_{index}", [(badge_x + dx - 4, front - 11, badge_z - 17),
             (badge_x + dx + 4, front - 11, badge_z - 3),
             (badge_x + dx - 4, front - 11, badge_z + 10),
             (badge_x + dx + 1, front - 11, badge_z + 21)],
             dims.get("badgeWaveRadius", 2.7), "brass")
    root["asset_status"] = "model_candidate_awaiting_user_review"
    root["footprint_cells"] = 4
    root["reference_building"] = "solar_power_plant"
    root["future_output_relative_to_solar"] = .85
    root["runtime_integration_active"] = False
    root["entry_axis"] = "local negative Y"
    return root


if __name__ == "__main__":
    pack.BUILDERS["geothermal_power_plant"] = build_geothermal_power_plant
    pack.main()
