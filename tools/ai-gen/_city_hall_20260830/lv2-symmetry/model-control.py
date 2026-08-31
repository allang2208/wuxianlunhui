"""Author a symmetric front window/banner control; selected raw owns all other art."""
import importlib.util
import json
import math
from pathlib import Path
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

HERE = Path(__file__).resolve().parent
source = HERE.parents[1] / "city-hall-building-blender.py"
spec = importlib.util.spec_from_file_location("city_hall_symmetry_source", source)
city = importlib.util.module_from_spec(spec)
spec.loader.exec_module(city)
kit, bpy, pack = city.kit, city.bpy, city.pack
anchors = {}


def arch_shape(collection, root, name, x, y, bottom, width, height, depth, material):
    radius = width / 2
    spring = bottom + height - radius
    outline = [(x - radius, bottom), (x + radius, bottom)]
    outline += [(x + radius * math.cos(i * math.pi / 16),
                 spring + radius * math.sin(i * math.pi / 16)) for i in range(17)]
    vertices = [(xx, y + side * depth / 2, zz) for side in (-1, 1) for xx, zz in outline]
    n = len(outline)
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, n * 2))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    kit.bevel(obj, .4, 2)
    return obj


def build(spec):
    root = city.build_city_hall(spec)
    collection = root.users_collection[0]
    for obj in list(root.children):
        if obj.name.startswith(("CityHallLV2_UpperWindow_", "CityHallLV2_CivicBanner_")):
            bpy.data.objects.remove(obj, do_unlink=True)
    mats = {key: bpy.data.materials["CityHallLV2_MAT_" + key]
            for key in ("stone", "glass", "banner", "brass")}
    mats["iron"] = bpy.data.materials["MAT_Blackened_Iron"]
    front = -80
    for side in (-1, 1):
        x, bottom = side * 99, 135
        name = f"CityHallLV2_SymmetricWindow_{side}"
        arch_shape(collection, root, name + "_StoneFrame", x, front - 5, bottom, 36, 61, 5, mats["stone"])
        arch_shape(collection, root, name + "_Glass", x, front - 9, bottom + 4, 27, 53, 2, mats["glass"])
        kit.box(collection, root, name + "_Mullion", (2, 2, 48), (x, front - 11, bottom + 28), mats["iron"], bevel_width=.3)
        kit.box(collection, root, name + "_Transom", (26, 2, 2), (x, front - 11, bottom + 24), mats["iron"], bevel_width=.3)
        bx = side * 137
        kit.box(collection, root, f"CityHallLV2_SymmetricBanner_{side}", (21, 3, 56),
                (bx, front - 10, 167), mats["banner"], bevel_width=.6)
        kit.box(collection, root, f"CityHallLV2_SymmetricBannerRail_{side}", (25, 4, 3),
                (bx, front - 12, 197), mats["brass"], bevel_width=.5)
        anchors[f"window_{side}"] = (x, front - 11, bottom + 30)
        anchors[f"banner_{side}"] = (bx, front - 12, 167)
    root["revision_scope"] = "Front upper windows and banners only; approved raw owns roof, tower and other components."
    return root


pack.BUILDERS["city_hall_lv2"] = build
pack.main()
root = bpy.data.objects["CITY_HALL_LV2_ROOT_ROT_Z_44_8"]
camera = bpy.context.scene.camera
projected = {}
for name, local in anchors.items():
    v = world_to_camera_view(bpy.context.scene, camera, root.matrix_world @ Vector(local))
    projected[name] = [round(v.x * 1024, 2), round((1 - v.y) * 1024, 2)]
(HERE / "layout-anchors.json").write_text(json.dumps(projected, indent=2) + "\n", encoding="utf-8")
