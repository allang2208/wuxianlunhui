"""Add an upper entry and three-sided balcony rail to the set-back LV2 tower."""
import importlib.util
import json
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
revision_path = HERE / "revision.json"
revision = json.loads(revision_path.read_text(encoding="utf-8"))
module_spec = importlib.util.spec_from_file_location(
    "city_hall_balcony_source", REPO / "tools/ai-gen/city-hall-building-blender.py")
city = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(city)
kit = city.kit

bpy.ops.wm.open_mainfile(filepath=str(REPO / revision["sourceModel"]))
scene = bpy.context.scene
root = bpy.data.objects["CITY_HALL_LV2_ROOT_ROT_Z_44_8"]
collection = root.users_collection[0]
initial_names = {obj.name for obj in root.children_recursive}
mats = {key: bpy.data.materials["CityHallLV2_MAT_" + key]
        for key in ("stone", "timber", "interior")}
mats["iron"] = bpy.data.materials["MAT_Blackened_Iron"]
prefix = "CityHallLV2_Balcony"


def box(name, size, position, material="stone", bevel=0.6):
    return kit.box(collection, root, prefix + "_" + name, size, position,
                   mats[material], bevel_width=bevel)


balcony, door = revision["balcony"], revision["door"]
floor = float(balcony["deckTopZ"])
half = float(balcony["railHalfWidth"])
front_y, back_y = balcony["railFrontY"], balcony["railBackY"]
rail_top = floor + balcony["railHeight"]
tower = bpy.data.objects["CityHallLV2_ClockTower_BearingShell"]
tower_front = tower.location.y - tower.dimensions.y / 2

# The gallery slab remains the structural support. This thin floor meets storey two.
box("Paving", (balcony["deckWidth"], balcony["deckDepth"], balcony["deckThickness"]),
    (0, balcony["deckCenterY"], floor - balcony["deckThickness"] / 2))

# Keep the existing seal as one editable group on the center of the front rail.
crest_parts = [obj for obj in root.children if obj.name.startswith("CityHallLV2_CivicSeal_")]
crest_group = bpy.data.objects.new(prefix + "_CivicSeal_Pivot", None)
collection.objects.link(crest_group)
crest_group.parent = root
old_pivot = Vector(revision["crest"]["originalPivot"])
for obj in crest_parts:
    local = obj.matrix_local.copy()
    obj.parent = crest_group
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = Matrix.Translation(-old_pivot) @ local
crest_group.location = revision["crest"]["balconyPivot"]
crest_group.scale = (revision["crest"]["scale"],) * 3

# A real shallow opening, retained as an editable boolean in the bearing shell.
cut_height = door["height"] + 2
cut_front = tower_front - 7
cut_back = tower_front + door["recessDepth"]
cutter = box("Door_RecessCutter", (door["width"] + 2, cut_back - cut_front, cut_height),
             (0, (cut_front + cut_back) / 2, floor + cut_height / 2), "interior", bevel=0)
cutter.hide_render = True
cutter.display_type = "WIRE"
for obj in (tower, bpy.data.objects["CityHallLV2_ClockTower_Band_123"]):
    modifier = obj.modifiers.new(prefix + "_DoorOpening", "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.solver = "EXACT"
    modifier.object = cutter
box("Door_Interior", (door["width"] + 1, 1, cut_height - 1),
    (0, cut_back - 0.7, floor + cut_height / 2), "interior", bevel=0)

frame = door["frameThickness"]
for side in (-1, 1):
    box(f"Door_Jamb_{side}", (frame, 11, cut_height + 4),
        (side * (door["width"] / 2 + 1 + frame / 2), tower_front - 2,
         floor + (cut_height + 4) / 2))
box("Door_Lintel", (door["width"] + 2 + frame * 2, 12, 8),
    (0, tower_front - 2, floor + cut_height + 4))
box("Door_Threshold", (door["width"] + 2, 12, 1),
    (0, tower_front - 4, floor + 0.5), bevel=0.3)
kit.double_doors(collection, root, prefix + "_Door", (0, tower_front - 3, floor + 1),
                 door["width"], door["height"], mats["timber"], mats["iron"],
                 open_angle=door["openAngle"])

# Low stone posts support open ironwork, leaving the upper windows readable.
def post(name, x, y):
    box(name + "_Foot", (9, 9, 4), (x, y, floor + 2))
    box(name + "_Shaft", (6, 6, balcony["railHeight"] - 5),
        (x, y, floor + (balcony["railHeight"] - 5) / 2))
    box(name + "_Cap", (9, 9, 4), (x, y, rail_top - 3))


front_bays = balcony["frontBays"]
for i in range(front_bays + 1):
    post(f"FrontPost_{i:02d}", -half + 2 * half * i / front_bays, front_y)
box("Front_Handrail", (2 * half, 6, 5), (0, front_y, rail_top - 2.5))
box("Front_LowerRail", (2 * half, 3, 3), (0, front_y, floor + 6), "iron", bevel=0.4)
for bay in range(front_bays):
    start = -half + 2 * half * bay / front_bays
    count = balcony["balustersPerFrontBay"]
    for j in range(1, count + 1):
        x = start + (2 * half / front_bays) * j / (count + 1)
        box(f"FrontBaluster_{bay}_{j}", (2.3, 2.6, balcony["railHeight"] - 10),
            (x, front_y, floor + (balcony["railHeight"] + 2) / 2), "iron", bevel=0.3)

for side in (-1, 1):
    x = side * half
    post(f"SideWallPost_{side}", x, back_y)
    box(f"Side_Handrail_{side}", (6, back_y - front_y, 5),
        (x, (front_y + back_y) / 2, rail_top - 2.5))
    box(f"Side_LowerRail_{side}", (3, back_y - front_y, 3),
        (x, (front_y + back_y) / 2, floor + 6), "iron", bevel=0.4)
    count = balcony["balustersPerSideBay"]
    for j in range(1, count + 1):
        y = front_y + (back_y - front_y) * j / (count + 1)
        box(f"SideBaluster_{side}_{j}", (2.6, 2.3, balcony["railHeight"] - 10),
            (x, y, floor + (balcony["railHeight"] + 2) / 2), "iron", bevel=0.3)

root["revision_scope"] = "Upper tower doorway, balcony floor and three-sided railing; civic seal on front rail."
root["asset_status"] = "balcony_model_awaiting_user_review"
bpy.context.view_layer.update()
scene.render.filepath = str(REPO / revision["modelPreview"])
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(REPO / revision["model"]))
bpy.ops.render.render(write_still=True)
city.pack.publish_approval_preview(revision["assetId"], scene.render.filepath)
kit.render_depth(scene, root, scene.camera, str(REPO / revision["depth"]), "CityHallLV2_Balcony")

revision["status"] = "balcony_model_ready_for_user_review"
revision["applied"] = {
    "towerCenterY": float(tower.location.y),
    "towerFrontY": tower_front,
    "deckTopZ": floor,
    "railingTopZ": rail_top,
    "doorBaseZ": floor + 1,
    "addedObjects": sorted(obj.name for obj in root.children_recursive if obj.name not in initial_names),
    "relocatedCrestObjects": sorted(obj.name for obj in crest_parts),
    "camera": "Exact camera inherited from the tower-setback model; no reframing",
    "runtimeIntegrationActive": False
}
revision_path.write_text(json.dumps(revision, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Balcony complete: deck z={floor:g}, railing top z={rail_top:g}, door base z={floor + 1:g}")
print(f"Tower center retained at y={tower.location.y:g}; source model and older art preserved.")
