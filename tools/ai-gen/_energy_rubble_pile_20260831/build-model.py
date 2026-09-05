"""Single-cell jagged rubble pile, authored model only; no runtime installation."""

import importlib.util
import json
import math
import random
import shutil
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
spec = importlib.util.spec_from_file_location("building_kit", REPO / "tools/ai-gen/building-component-kit.py")
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)
RNG = random.Random(122831)
NAME = "energy_rubble_pile"
CAMERA = {"elevation": 30, "azimuth": 0, "buildingRotationZ": 44.8,
          "resolution": 1024, "bottomY": 848, "topMargin": 80, "widthMargin": 0.86}

# Broad, asymmetrical chunks; no cylindrical pucks or repeated gravel texture.
ROCKS = [
    (-70,-69,42,33,16,12), (-32,-75,34,30,12,-13), (7,-73,40,32,18,19),
    (47,-69,39,34,18,-12), (76,-62,33,35,12,8),
    (-75,-30,38,39,20,-22), (-40,-37,53,42,22,13), (-1,-34,40,38,27,-11),
    (36,-29,42,44,20,20), (73,-23,37,40,20,-10),
    (-74,11,40,42,17,-9), (-39,6,43,43,26,22), (4,4,53,48,34,10),
    (48,7,44,35,26,-27), (79,17,26,35,16,-3),
    (-74,53,42,40,14,16), (-34,45,46,40,23,-6), (11,49,51,39,23,28),
    (52,50,48,42,19,4), (80,57,27,28,10,18),
    (-65,81,36,22,10,-20), (-22,80,43,26,11,13),
    (24,82,42,22,13,-16), (65,81,36,24,10,10),
]
ORE_ROCKS = {6, 11, 12, 18}


def mesh_object(name, vertices, faces, materials, indices=None):
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for mat in materials:
        mesh.materials.append(mat)
    if indices:
        for poly, index in zip(mesh.polygons, indices):
            poly.material_index = index
    obj = bpy.data.objects.new(name, mesh)
    COLLECTION.objects.link(obj)
    obj.parent = ROOT
    return obj


def make_ground_rocks(materials):
    """Overlapping individual rock volumes form the foot of the pile; no slab."""
    count = 0
    for row in range(7):
        for column in range(7):
            x = -82 + column*27.3 + RNG.uniform(-3.0, 3.0)
            y = -82 + row*27.3 + RNG.uniform(-3.0, 3.0)
            width, depth = RNG.uniform(34, 43), RNG.uniform(32, 42)
            center_weight = max(0, 1-max(abs(x),abs(y))/95)
            height = RNG.uniform(6.5, 10.0) + 8*center_weight
            sides = RNG.choice((5, 6, 7))
            polygon = []
            for i in range(sides):
                angle = math.tau*i/sides + RNG.uniform(-.11,.11)
                radius = RNG.uniform(.82,1.0)
                polygon.append((math.cos(angle)*width*.5*radius,
                                math.sin(angle)*depth*.5*radius))
            offset = (row*3+column)%len(materials)
            mats = [materials[offset],materials[(offset+1)%5],materials[(offset+2)%5]]
            obj = rock_half(f"Grounding_Rock_{count:02d}",polygon,height,mats)
            obj.rotation_euler.z = math.radians(RNG.uniform(-40,40))
            rotation = obj.rotation_euler.to_matrix()
            vertices = [rotation @ v.co for v in obj.data.vertices]
            obj.location = (x,y,.25-min(v.z for v in vertices))
            obj.location.x += min(0,99-x-max(v.x for v in vertices)) + max(0,-99-x-min(v.x for v in vertices))
            obj.location.y += min(0,99-y-max(v.y for v in vertices)) + max(0,-99-y-min(v.y for v in vertices))
            count += 1
    return count


def cut_polygon(poly, boundary, keep_left):
    result = []
    for a, b in zip(poly, poly[1:] + poly[:1]):
        inside_a = a[0] <= boundary if keep_left else a[0] >= boundary
        inside_b = b[0] <= boundary if keep_left else b[0] >= boundary
        if inside_a:
            result.append(a)
        if inside_a != inside_b:
            t = (boundary-a[0]) / (b[0]-a[0])
            result.append((boundary, a[1]+t*(b[1]-a[1])))
    subdivided = []
    for a, b in zip(result, result[1:]+result[:1]):
        subdivided.append(a)
        if abs(a[0]-boundary) < .001 and abs(b[0]-boundary) < .001:
            for t in (.25, .5, .75):
                subdivided.append((boundary, a[1]+t*(b[1]-a[1])))
    return subdivided


def mineral_offset(y):
    """Small authored zigzag, used by both fracture walls and mineral inlay."""
    points = [(-30,-.4),(-10,-1.5),(-3,1.5),(5,-1.3),(12,1.0),(30,.4)]
    for a, b in zip(points, points[1:]):
        if y <= b[0]:
            t = max(0, min(1, (y-a[0])/(b[0]-a[0])))
            return a[1]+t*(b[1]-a[1])
    return points[-1][1]


def rock_half(name, polygon, height, materials, seam=None):
    n = len(polygon)
    slope_x, slope_y = RNG.uniform(-.1, .1), RNG.uniform(-.10, .10)
    vertices = []
    for scale, z in ((.78, .04*height), (1.0, .36*height), (.76, .82*height)):
        for x, y in polygon:
            on_seam = seam is not None and abs(x-seam) < .001
            px = x+mineral_offset(y*scale) if on_seam else x*scale
            local_z = z + slope_x*x + slope_y*y
            if scale == .76:
                local_z += RNG.uniform(-.045, .055)*height
                if not on_seam:
                    px *= RNG.uniform(.90, 1.10)
            vertices.append((px, y*scale, local_z))
    center_x = sum(p[0] for p in polygon)/n
    center_y = sum(p[1] for p in polygon)/n
    vertices.append((center_x*.84, center_y*.84, height))
    faces = [tuple(reversed(range(n)))]
    indices = [0]
    for ring in (0, 1):
        for i in range(n):
            j = (i+1) % n
            faces.append((ring*n+i, ring*n+j, (ring+1)*n+j, (ring+1)*n+i))
            indices.append(0 if ring == 0 else RNG.choice((0, 0, 1)))
    for i in range(n):
        faces.append((2*n+i, 2*n+(i+1)%n, 3*n))
        indices.append(RNG.choice((0, 0, 1, 2)))
    obj = mesh_object(name, vertices, faces, materials, indices)
    kit.bevel(obj, .32, 1)
    return obj


def build_rock(index, values, materials, ore_materials):
    x, y, width, depth, height, rotation = values
    sides = RNG.choice((6, 7, 8))
    polygon = []
    for i in range(sides):
        angle = math.tau*i/sides + RNG.uniform(-.07, .07)
        radius = RNG.uniform(.86, 1.0)
        polygon.append((math.cos(angle)*width*.5*radius, math.sin(angle)*depth*.5*radius))
    base = 3.0 + 8.0*max(0, 1-max(abs(x), abs(y))/100)
    objects = []
    if index in ORE_ROCKS:
        rotation += {6:-22, 11:46, 12:8, 18:-35}[index]
        gap = 8.0
        for label, boundary, left in (("A", -gap/2, True), ("B", gap/2, False)):
            half = cut_polygon(polygon, boundary, left)
            obj = rock_half(f"OreBearingRock_{index:02d}_{label}", half, height, materials, boundary)
            objects.append(obj)
        # Flat mineral exposed BELOW the surrounding broken stone tops. No
        # curves, pipes, caps, external bloom or upright crystal geometry.
        length = depth*.62
        samples = [-length*.5, -length*.25, 0, length*.25, length*.5]
        widths = [2.1, 3.0, 2.5, 3.2, 1.9]
        points = [(mineral_offset(py)-w,py) for py,w in zip(samples,widths)]
        points += [(mineral_offset(py)+w,py) for py,w in reversed(list(zip(samples,widths)))]
        core = mesh_object(f"Embedded_Mineral_Seam_{index:02d}",
                           [(px,py,height*.85 + .015*py) for px,py in points],
                           [tuple(reversed(range(len(points))))], [ore_materials[index%len(ore_materials)]])
        objects.append(core)
    else:
        objects.append(rock_half(f"Fractured_Rubble_{index:02d}", polygon, height, materials))
    for obj in objects:
        obj.location = (x, y, base)
        obj.rotation_euler.z = math.radians(rotation)
    # Keep every loose fragment inside the natural footprint, without zooming
    # the camera or clipping the final alpha to manufacture a correct boundary.
    rotation_matrix = objects[0].rotation_euler.to_matrix()
    points = [rotation_matrix @ v.co + Vector((x,y,base)) for obj in objects for v in obj.data.vertices]
    dx = min(0, 94-max(p.x for p in points)) + max(0, -94-min(p.x for p in points))
    dy = min(0, 94-max(p.y for p in points)) + max(0, -94-min(p.y for p in points))
    for obj in objects:
        obj.location.x += dx
        obj.location.y += dy


def main():
    global COLLECTION, ROOT
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    COLLECTION = bpy.data.collections.new("SingleCell_Energy_Rubble_Model")
    bpy.context.scene.collection.children.link(COLLECTION)
    ROOT = bpy.data.objects.new("Energy_Rubble_Root_44_8deg", None)
    COLLECTION.objects.link(ROOT)
    ROOT.rotation_euler.z = math.radians(CAMERA["buildingRotationZ"])
    stones = [kit.material("Rubble_Stone_"+str(i), (*rgb,1), roughness=.92)
              for i,rgb in enumerate(((.24,.26,.27),(.285,.30,.305),(.325,.335,.33),
                                       (.255,.27,.275),(.305,.31,.295)))]
    ores = [kit.material("Muted_Embedded_Energy_"+str(i), (*rgb,1), roughness=.65,
                         emission=((*rgb,1),.12))
            for i,rgb in enumerate(((.035,.30,.36),(.065,.38,.43)))]
    for index, values in enumerate(ROCKS):
        offset = index % len(stones)
        build_rock(index, values, [stones[offset], stones[(offset+1)%5], stones[(offset+2)%5]], ores)
    grounding_count = make_ground_rocks(stones)

    preview = OUT/(NAME+"_model_preview.png")
    kit.setup_scene({"camera":CAMERA}, str(preview))
    scene = bpy.context.scene
    # Use the common building light directions with restrained material contrast.
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -.12
    # A temporary four-point framing reference keeps the same nominal 1x1
    # camera scale. It has no faces and is removed before saving or rendering.
    framing = mesh_object("Temporary_Footprint_Framing",
                          [(-100,-100,0),(100,-100,0),(100,100,0),(-100,100,0)],[],[])
    camera = kit.setup_camera({"camera":CAMERA}, ROOT)
    framing_mesh = framing.data
    bpy.data.objects.remove(framing,do_unlink=True)
    bpy.data.meshes.remove(framing_mesh)
    scene.camera = camera
    bpy.context.view_layer.update()
    footprint_pixels = []
    for x,y in ((-100,-100),(100,-100),(100,100),(-100,100)):
        p = world_to_camera_view(scene,camera,ROOT.matrix_world @ Vector((x,y,0)))
        footprint_pixels.append([round(p.x*1024,3),round((1-p.y)*1024,3)])
    blend = OUT/(NAME+"_model.blend")
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    bpy.ops.render.render(write_still=True)
    approval = OUT/(NAME+"_model_approval_preview.png")
    shutil.copy2(preview, approval)
    depth = OUT/(NAME+"_body_depth.png")
    kit.render_depth(scene, ROOT, camera, str(depth), "EnergyRubblePile")
    manifest = {
        "id":NAME, "status":"model_candidate_awaiting_user_review", "version":2,
        "request":"One 1x1 stack of individual rocks, including the entire bottom layer; no ground plane, foundation, slab or platform. Keep the approximate isometric footprint and sparse embedded energy veins.",
        "assetClass":"surface_deposit", "foundationStyle":"none", "footprintCells":1,
        "footprintModelSize":[200,200], "camera":CAMERA,
        "footprintProjectionPixels":footprint_pixels,
        "geometry":{"rubbleChunkCount":len(ROCKS), "groundingRockCount":grounding_count,
                    "oreBearingChunkCount":len(ORE_ROCKS), "looseRockXYLimit":99,
                    "structure":"Individual overlapping bottom rocks support the larger rubble above; four exposed flat mineral seams remain embedded in upper stones. The outer edge is formed only by rock volumes.",
                    "noGroundPlane":True,"noFoundationSlab":True,
                    "noPipes":True,"noSeamCaps":True,"noUprightCrystals":True},
        "sources":{"script":"build-model.py", "sharedKit":"tools/ai-gen/building-component-kit.py"},
        "files":{"model":blend.name,"preview":preview.name,"approvalPreview":approval.name,"depth":depth.name,
                 "reviewBoard":"energy_rubble_pile_review_board.png"},
        "seed":122831,"aiGeneration":False,"runtimeInstalled":False,
        "scope":"Single model candidate only; old 16-frame tiles, fallback textures and game contracts remain unchanged.",
    }
    (OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"Model: {blend}")
    print(f"![Energy rubble model approval preview](<{approval.as_posix()}>)")


if __name__ == "__main__":
    main()
