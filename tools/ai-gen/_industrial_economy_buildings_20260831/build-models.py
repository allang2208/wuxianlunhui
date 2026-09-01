"""Three editable industrial-economy building candidates for World-122."""
import importlib.util
import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
module_spec = importlib.util.spec_from_file_location(
    "industrial_economy_pack", REPO / "tools/ai-gen/settlement-building-pack-blender.py")
pack = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(pack)
kit, bpy, Vector = pack.kit, pack.bpy, pack.mathutils.Vector


class Model:
    def __init__(self, asset_id, spec):
        self.id, self.spec, self.d = asset_id, spec, spec["dimensions"]
        self.c, self.root, self.m = pack.common_context(asset_id, spec)
        colors = {**spec["palette"], **spec.get("paletteOverrides", {})}
        for key, color in colors.items():
            metallic = .48 if key in ("iron", "brass", "steel") else 0
            self.m[key] = kit.material(asset_id + "_MAT_" + key, kit.rgba(color),
                                       roughness=.55 if metallic else .83, metallic=metallic)
        self.ground = self.d["foundation"][2]
        kit.masonry_plinth(self.c, self.root, self.n("Foundation"), self.d["foundation"],
                           self.m["foundation"], self.m["stone"])
        self.root["asset_status"] = "model_candidate_awaiting_user_review"
        self.root["runtime_integration_active"] = False
        self.root["proposed_footprint_cells"] = spec["footprintCells"]
        self.root["foundation_style"] = spec["foundationStyle"]
        self.root["entry_axis"] = "local negative Y"

    def n(self, name):
        return self.id + "_" + name

    def box(self, name, size, location, mat="iron", rotation=(0, 0, 0), bevel=1.5):
        return kit.box(self.c, self.root, self.n(name), size, location, self.m[mat],
                       rotation=rotation, bevel_width=bevel)

    def cyl(self, name, radius, length, location, mat="iron", rotation=(0, 0, 0)):
        return kit.cylinder(self.c, self.root, self.n(name), radius, length,
                            location, self.m[mat], rotation=rotation, vertices=32)

    def pipe(self, name, points, radius=7, mat="iron"):
        kit.industrial_pipe_path(self.c, self.root, self.n(name), points, radius, self.m[mat])

    def shell(self, name, size, center, door, mat="brick"):
        return kit.entry_bearing_shell(self.c, self.root, self.n(name), size, center,
            self.m[mat], self.m["stone"], self.m["timber"], self.m["iron"], self.m["interior"],
            door_size=door, door_open_angle=64)

    def window(self, name, position, width, height, side=False, rows=2, columns=2):
        kit.framed_glass_panel(self.c, self.root, self.n(name), position, width, height,
            self.m["glass"], self.m["stone"], self.m["iron"],
            orientation="side" if side else "front", vertical_divisions=columns,
            horizontal_divisions=rows, ornaments=False, depth=7)

    def crate(self, name, size, position):
        kit.freight_crate(self.c, self.root, self.n(name), size, position,
                          self.m["timber"], self.m["iron"])

    def mesh(self, name, points, faces, mat):
        mesh = bpy.data.meshes.new(self.n(name) + "_Mesh")
        mesh.from_pydata(points, [], faces)
        mesh.update()
        mesh.materials.append(self.m[mat])
        obj = bpy.data.objects.new(self.n(name), mesh)
        self.c.objects.link(obj)
        obj.parent = self.root
        kit.bevel(obj, 1.2, 2)
        return obj


def build_oil_power_plant(spec):
    m = Model("oil_power_plant", spec)
    d, g = m.d, m.ground
    cx, cy = d["hallCenter"]
    bw, bd, bh = d["hallBody"]
    shell = m.shell("EngineHall", (bw, bd, bh), (cx, cy, g), d["door"])
    front, left, top = shell["front"], shell["left"], shell["top"]
    m.root["main_storeys"] = 1
    kit.gabled_prism(m.c, m.root, m.n("EngineHall_Roof"), bw + 22, bd + 22,
                     d["roofRise"], (cx, cy, top), m.m["brick"], m.m["roof"])
    for x in (cx - bw / 2, cx + bw / 2):
        m.box(f"CornerPier_{x}", (24, bd + 12, 18), (x, cy, g + 18), "stone")
    m.box("FrontCornice", (bw + 24, 24, 16), (cx, front - 6, top - 8), "stone")
    for index, x in enumerate((cx - 155, cx + 155)):
        m.window(f"FrontWindow_{index}", (x, front - 12, g + 116), 76, 88)
    for index, y in enumerate((cy - 115, cy + 105)):
        m.window(f"SideWindow_{index}", (left - 12, y, g + 152), 91, 72, side=True)
    m.box("EntryThreshold", (170, 65, 8), (cx, front - 31, g + 4), "stone")
    # The tanks occupy a dedicated yard beside the hall, not the entrance.
    for index, center in enumerate(d["tankCenters"]):
        x, y, z = center
        m.box(f"Tank{index}_Bed", (176, 222, 12), (x, y, g + 6), "stone")
        for side in (-1, 1):
            m.box(f"Tank{index}_Saddle_{side}", (132, 24, 40),
                  (x, y + side * 56, g + 28), "iron", bevel=4)
        kit.banded_storage_tank(m.c, m.root, m.n(f"FuelTank{index}"), center,
            d["tankRadius"], d["tankLength"], m.m["accent"], m.m["iron"], axis="Y")
        m.cyl(f"Tank{index}_FillNeck", 15, 20, (x, y, z + d["tankRadius"] + 7), "iron")
        m.cyl(f"Tank{index}_FillCap", 20, 5, (x, y, z + d["tankRadius"] + 18), "steel")
        m.pipe(f"Tank{index}_Feed", [(x + 69, y, z - 26), (left - 32, y, z - 26),
               (left - 32, y, g + 80), (left + 10, y, g + 80)], 8)
        kit.torus_ring(m.c, m.root, m.n(f"Tank{index}_Valve"), 14, 3,
                       (left - 33, y - 7, g + 100), m.m["brass"], rotation=(90, 0, 0), major_segments=24)
    for index, (x, y) in enumerate(d["exhaustCenters"]):
        height = d["exhaustHeight"] - index * 28
        m.pipe(f"Exhaust{index}", [(x, y, top - 8), (x, y, height),
               (x, y - 24, height)], 17)
        m.cyl(f"Exhaust{index}_Collar", 22, 11, (x, y, top + 52), "steel")
        m.cyl(f"Exhaust{index}_Mouth", 13.5, 2, (x, y - 26, height), "interior", (90, 0, 0))
    m.box("RadiatorHousing", (18, 100, 79), (left - 15, cy - 7, g + 66), "iron", bevel=3)
    for row in range(6):
        m.box(f"RadiatorFin_{row}", (12, 89, 5), (left - 27, cy - 7, g + 39 + row * 11), "steel")
    m.box("FuelBadge_Back", (94, 10, 48), (cx, front - 15, g + 191), "iron", bevel=5)
    # An extruded drop is a real no-text badge and enters the same Depth.
    pts = [(-17, -6), (-14, -20), (0, -26), (14, -20), (17, -6), (0, 22)]
    vertices = [(cx + x, front - 24 + dy, g + 194 + z) for dy in (0, -7) for x, z in pts]
    faces = [tuple(range(5, -1, -1)), tuple(range(6, 12))]
    faces += [(i, (i + 1) % 6, (i + 1) % 6 + 6, i + 6) for i in range(6)]
    m.mesh("FuelBadge_Droplet", vertices, faces, "accent")
    return m.root


def build_cannery(spec):
    m = Model("cannery", spec)
    d, g = m.d, m.ground
    cx, cy = d["hallCenter"]
    bw, bd, bh = d["hallBody"]
    shell = m.shell("ProcessingHall", (bw, bd, bh), (cx, cy, g), d["door"])
    front, left, top = shell["front"], shell["left"], shell["top"]
    m.root["main_storeys"] = 1
    m.root["roof_teeth"] = d["roofTeeth"]
    # Three true sawtooth bays, each with a front-facing vertical glazed rise.
    count, rise = d["roofTeeth"], d["roofRise"]
    bay = bd / count
    for index in range(count):
        y0, y1 = front + index * bay, front + (index + 1) * bay
        xl, xr = cx - bw / 2 - 7, cx + bw / 2 + 7
        for side, x in (("Left", xl), ("Right", xr)):
            m.mesh(f"RoofBay{index}_{side}Gable", [(x, y0, top), (x, y0, top + rise), (x, y1, top)], [(0, 1, 2)], "brick")
        length = math.hypot(bay, rise)
        m.box(f"RoofBay{index}_SlopedCover", (bw + 20, length + 4, 7),
              (cx, (y0 + y1) / 2, top + rise / 2), "roof", (-math.degrees(math.atan2(rise, bay)), 0, 0), bevel=1)
        m.window(f"RoofBay{index}_Clerestory", (cx, y0 - 3, top + rise / 2),
                 bw - 18, rise - 12, columns=6, rows=1)
        m.box(f"RoofBay{index}_UpperCap", (bw + 24, 13, 10), (cx, y0 - 1, top + rise + 2), "iron")
    for index, x in enumerate((cx - 210, cx + 210)):
        m.window(f"FrontFactoryWindow_{index}", (x, front - 12, g + 115), 92, 100)
    for index, y in enumerate((cy - 152, cy + 5, cy + 162)):
        m.window(f"SideFactoryWindow_{index}", (left - 12, y, g + 173), 105, 70, side=True, columns=3)
    m.box("FrontStringCourse", (bw + 12, 20, 14), (cx, front - 7, top - 13), "stone")
    for index, x in enumerate((cx - bw / 2 + 4, cx + bw / 2 - 4)):
        m.box(f"FrontBrickPier_{index}", (22, 26, bh), (x, front - 6, g + bh / 2), "brick")
    dock_w, dock_d, dock_h = d["dockSize"]
    dock_y = front - dock_d / 2 + 10
    m.box("LoadingDock", d["dockSize"], (cx, dock_y, g + dock_h / 2), "stone", bevel=3)
    m.box("DoorRamp", (d["door"][0] + 8, 40, 8), (cx, front - 12, g + 4), "stone")
    for index, center in enumerate(d["retortCenters"]):
        x, y, z = center
        m.box(f"Retort{index}_Pad", (108, 110, 12), (x, y, g + 6), "stone")
        kit.banded_storage_tank(m.c, m.root, m.n(f"Retort{index}"), center,
            d["retortRadius"], d["retortLength"], m.m["steel"], m.m["iron"], axis="Z")
        m.pipe(f"Retort{index}_SteamFeed", [(x + 37, y, z + 26), (left - 24, y, z + 26),
               (left - 24, y, g + 55), (left + 10, y, g + 55)], 6, "brass")
        m.cyl(f"Retort{index}_Gauge", 12, 6, (x, y - 44, z + 10), "stone", (90, 0, 0))
    # Dock goods are kept clear of the centered entrance.
    m.crate("DockCrate", (78, 67, 56), (cx + 125, dock_y, g + dock_h + 28))
    m.box("TinPallet", (92, 72, 10), (cx - 133, dock_y, g + dock_h + 5), "timber")
    for index, (dx, dy) in enumerate(((-21, -15), (15, -15), (-21, 17), (15, 17))):
        x, y, z = cx - 130 + dx, dock_y + dy, g + dock_h + 26
        m.cyl(f"DockTin{index}", 14, 33, (x, y, z), "steel")
        m.cyl(f"DockTin{index}_Rim", 14.8, 3, (x, y, z + 16), "iron")
    m.box("TinBadge_Back", (98, 12, 49), (cx, front - 17, g + 199), "iron", bevel=5)
    m.cyl("TinBadge_Can", 18, 34, (cx, front - 34, g + 199), "steel")
    for side in (-1, 1):
        m.cyl(f"TinBadge_Rim_{side}", 19.5, 4, (cx, front - 34, g + 199 + side * 16), "brass")
    return m.root


def build_trading_company(spec):
    m = Model("trading_company", spec)
    d, g = m.d, m.ground
    cx, cy = d["hallCenter"]
    bw, bd = d["hallBody"]
    floors = d["floors"]
    shell = m.shell("OfficeFloor1", (bw, bd, floors[0]), (cx, cy, g), d["door"])
    front, left = shell["front"], shell["left"]
    m.root["main_storeys"] = len(floors)
    m.root["attached_freight_wing_storeys"] = 1
    upper = bpy.data.objects.new(m.n("UpperFloors_AlignedRoot"), None)
    m.c.objects.link(upper)
    upper.parent = m.root
    upper.location = (cx, cy, g + floors[0])
    kit.stacked_bearing_shells(m.c, upper, m.n("OfficeUpper"),
        [(bw, bd, height) for height in floors[1:]], m.m["brick"],
        band_mat=m.m["stone"], band_height=16)
    floor_base = g
    for level, height in enumerate(floors, start=1):
        if level > 1:
            m.box(f"OfficeFloor{level}_FrontBand", (bw + 14, 18, 16),
                  (cx, front - 7, floor_base), "stone")
            m.box(f"OfficeFloor{level}_SideBand", (18, bd + 14, 16),
                  (left - 7, cy, floor_base), "stone")
        xs = (cx - 160, cx + 160) if level == 1 else (cx - 160, cx, cx + 160)
        for index, x in enumerate(xs):
            m.window(f"OfficeFloor{level}_FrontWindow{index}", (x, front - 14, floor_base + height * .52), 74, 84)
        if level > 1:
            for index, y in enumerate((cy - 178, cy, cy + 178)):
                m.window(f"OfficeFloor{level}_SideWindow{index}", (left - 14, y, floor_base + height * .52), 85, 84, side=True)
        floor_base += height
    for side, x in (("Left", left + 1), ("Right", cx + bw / 2 - 1)):
        m.box(f"Office_{side}StonePilaster", (22, 22, sum(floors)),
              (x, front - 8, g + sum(floors) / 2), "stone")
    m.box("OfficeTopCornice", (bw + 28, bd + 28, 22), (cx, cy, floor_base + 3), "stone", bevel=3)
    kit.gabled_prism(m.c, m.root, m.n("OfficeRoof"), bw + 32, bd + 32,
        d["roofRise"], (cx, cy, floor_base + 14), m.m["brick"], m.m["roof"])
    # The lower freight wing shares the office's left wall, not a detached shed.
    ax, ay = d["annexCenter"]
    aw, ad, ah = d["annexBody"]
    annex = m.shell("FreightWing", (aw, ad, ah), (ax, ay, g), (106, 113))
    kit.gabled_prism(m.c, m.root, m.n("FreightWingRoof"), aw + 16, ad + 16,
        d["annexRoofRise"], (ax, ay, g + ah), m.m["brick"], m.m["roof"])
    m.window("FreightWingSideWindow", (ax - aw / 2 - 10, ay - 80, g + 95), 83, 54, side=True)
    m.box("FreightWingDock", (aw - 12, 115, 14), (ax, annex["front"] - 46, g + 7), "stone")
    m.crate("FreightCrate1", (71, 64, 56), (ax - 73, annex["front"] - 57, g + 42))
    m.crate("FreightCrate2", (65, 58, 48), (ax + 73, annex["front"] - 55, g + 38))
    # Shallow bronze canopy and four columns, clear of the open office entry.
    pw, pd, ph = d["porticoSize"]
    py = front - pd / 2 + 12
    pz = g + floors[0] + 9
    m.box("PorticoCanopy", d["porticoSize"], (cx, py, pz), "brass", bevel=3)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = cx + sx * (pw / 2 - 13), py + sy * (pd / 2 - 15)
            m.cyl(f"PorticoColumn_{sx}_{sy}", 9, floors[0], (x, y, g + floors[0] / 2), "brass")
            m.box(f"PorticoColumnBase_{sx}_{sy}", (27, 27, 12), (x, y, g + 6), "stone")
    m.box("OfficeThreshold", (pw + 10, pd + 14, 6), (cx, py, g + 3), "stone")
    # A cargo crate and outbound arrow, not a stock chart or a real company logo.
    by, bz = py - pd / 2 - 8, pz + 34
    m.box("TradeBadge_Back", (138, 13, 55), (cx, by, bz), "iron", bevel=5)
    m.crate("TradeBadge_Crate", (39, 17, 33), (cx - 32, by - 14, bz))
    m.box("TradeBadge_ArrowShaft", (34, 9, 9), (cx + 16, by - 15, bz), "brass")
    m.mesh("TradeBadge_ArrowHead", [(cx + 30, by - 20, bz - 17), (cx + 51, by - 20, bz),
        (cx + 30, by - 20, bz + 17), (cx + 30, by - 11, bz - 17),
        (cx + 51, by - 11, bz), (cx + 30, by - 11, bz + 17)],
        [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], "brass")
    return m.root


if __name__ == "__main__":
    arguments = pack.parse_args()
    manifest_path, asset_id, blend_path, preview_path, depth_path = arguments[:5]
    pack.BUILDERS.update(oil_power_plant=build_oil_power_plant,
                         cannery=build_cannery, trading_company=build_trading_company)
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
        corners.append([round(p.x * scene.render.resolution_x, 3), round((1 - p.y) * scene.render.resolution_y, 3)])
    output = Path(blend_path).parent
    (output / "model-metadata.json").write_text(json.dumps({
        "assetId": asset_id, "name": spec["name"], "status": "model_candidate_awaiting_user_review",
        "model": Path(blend_path).name,
        "preview": Path(preview_path).name.replace("_model_preview", "_model_approval_preview"),
        "bodyDepth": Path(depth_path).name, "bodyDepthIncludesFoundation": True,
        "proposedFootprintCells": spec["footprintCells"], "foundationStyle": spec["foundationStyle"],
        "foundationCornersPx": corners, "cameraElevation": 30, "rootRotationZ": 44.8,
        "objectCount": len(root.children_recursive), "runtimeInstalled": False,
        "aiGenerationStarted": False, "userApproved": False,
        "builder": source["builder"], "componentSource": source["componentSource"]
    }, ensure_ascii=False, indent=2), encoding="utf-8")
