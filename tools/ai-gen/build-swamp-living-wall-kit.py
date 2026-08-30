"""Native deadwood wall models. The accepted vine gate is a read-only dependency."""
import importlib.util
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
OUT = HERE / "_swamp_deadwood_wall_kit_20260830"
spec = importlib.util.spec_from_file_location("swamp_source", HERE / "build-swamp-stone-wall-kit.py")
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
kit = source.kit
NAMES = ["碎枝随机 A", "碎枝随机 B", "碎枝随机 C", "碎枝随机 D"]
VARIANT_SEEDS = [831011, 831077, 831149, 831233]


def bark_material(name, dark, light):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = .91
    shader.inputs["Specular IOR Level"].default_value = .18
    coords = nodes.new("ShaderNodeTexCoord")
    # Branch-local UV: grain follows each bent limb, not world Z.
    stretch = nodes.new("ShaderNodeVectorMath")
    stretch.operation = "MULTIPLY"
    stretch.inputs[1].default_value = (5.8, .65, 1)
    links.new(coords.outputs["UV"], stretch.inputs[0])
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.1
    noise.inputs["Detail"].default_value = 5
    noise.inputs["Roughness"].default_value = .77
    links.new(stretch.outputs[0], noise.inputs[0])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = .32
    ramp.color_ramp.elements[1].position = .68
    for element, color in zip(ramp.color_ramp.elements, (dark, light)):
        element.color = source.linear(color)
    links.new(noise.outputs["Fac"], ramp.inputs[0])
    links.new(ramp.outputs[0], shader.inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .65
    bump.inputs["Distance"].default_value = .065
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs[0], shader.inputs["Normal"])
    return mat


class Deadwood:
    """Merged tapered branch meshes with longitudinal grain and uneven bark."""
    def __init__(self):
        self.vertices, self.faces, self.uvs, self.materials = [], [], [], []

    def limb(self, points, radius, material=0, tip=.055, phase=0):
        points = [Vector(p) for p in points]
        # Linear segments are intentionally slightly crooked rather than smooth hoses.
        samples = []
        for a, b in zip(points, points[1:]):
            for j in range(5):
                samples.append(a.lerp(b, j / 5))
        samples.append(points[-1])
        start = len(self.vertices)
        sides = 10 if radius > .06 else 7
        distance = 0
        for j, p in enumerate(samples):
            t = j / (len(samples) - 1)
            tangent = (samples[min(j + 1, len(samples) - 1)] - samples[max(0, j - 1)]).normalized()
            side = tangent.cross(Vector((0, 1, .13))).normalized()
            normal = side.cross(tangent).normalized()
            if j:
                distance += (p - samples[j - 1]).length
            r = radius * ((1 - t) ** .65 * (1 - tip) + tip)
            for k in range(sides):
                angle = 2 * math.pi * k / sides
                rough = 1 + .19 * math.sin(k * 2.3 + phase) + .10 * math.sin(t * 22 + k + phase)
                pos = p + (side * math.cos(angle) + normal * math.sin(angle)) * r * rough
                self.vertices.append(pos)
                self.uvs.append((k / sides, distance))
            if j:
                for k in range(sides):
                    a = start + (j - 1) * sides + k
                    b = start + (j - 1) * sides + (k + 1) % sides
                    self.faces.append((a, b, b + sides, a + sides))
                    self.materials.append(material)
        self.faces.append(tuple(start + (len(samples) - 1) * sides + k for k in range(sides)))
        self.materials.append(material)
        self.faces.append(tuple(start + k for k in reversed(range(sides))))
        self.materials.append(material)

    def finish(self, collection, mats):
        mesh = bpy.data.meshes.new("Interlocking deadwood with branch-local grain")
        mesh.from_pydata(self.vertices, [], self.faces)
        for mat in mats:
            mesh.materials.append(mat)
        uv = mesh.uv_layers.new(name="BranchGrain")
        for poly, material in zip(mesh.polygons, self.materials):
            poly.material_index = material
            poly.use_smooth = True
            for loop in poly.loop_indices:
                uv.data[loop].uv = self.uvs[mesh.loops[loop].vertex_index]
        mesh.update()
        obj = bpy.data.objects.new("Dry branches, splinters and tangled roots", mesh)
        collection.objects.link(obj)


def face_point(side, along, z, depth=.78):
    return Vector(((along, -depth, z), (depth, along, z), (-along, depth, z), (-depth, -along, z))[side])


def crooked_path(start, end, rng, bend=.13):
    start, end = Vector(start), Vector(end)
    points = [start]
    for t in (.25, .55, .78):
        p = start.lerp(end, t)
        p += Vector((rng.uniform(-bend, bend), rng.uniform(-bend, bend), rng.uniform(-bend, bend)))
        points.append(p)
    points.append(end)
    return points


def build(index, mats):
    col = bpy.data.collections.new(f"SwampDeadwood_{chr(65 + index)}_{NAMES[index]}")
    bpy.context.scene.collection.children.link(col)
    wood = Deadwood()
    seam = random.Random(83061)
    # There is no thick root/trunk hidden behind the surface. The common
    # volume is itself made only of short, fine twigs (base radius <= .042).
    for j in range(560):
        start = Vector((seam.uniform(-.72, .72), seam.uniform(-.72, .72), seam.uniform(.10, 2.90)))
        end = start + Vector((seam.uniform(-.55, .55), seam.uniform(-.55, .55), seam.uniform(-.48, .58)))
        end = Vector((max(-.78, min(.78, end.x)), max(-.78, min(.78, end.y)), max(.065, min(3.02, end.z))))
        wood.limb(crooked_path(start, end, seam, .038), seam.uniform(.021, .041), j % 3, .03, j)
    # Shared fine-twig collar joins both isometric axes; the visible middle
    # uses a separate RNG for every variant, never a random sprite transform.
    for side in range(4):
        for sign in (-1, 1):
            for j in range(35):
                z = seam.uniform(.13, 2.90)
                start = face_point(side, sign * seam.uniform(.74, .89), z, .79)
                end = face_point(side, sign * seam.uniform(.90, 1.045),
                                 max(.08, min(3.14, z + seam.uniform(-.26, .30))), .85)
                wood.limb(crooked_path(start, end, seam, .032), seam.uniform(.016, .035), j % 3, .025, j)
    # Ground contact is loose small sticks, not the old thick buttress roots.
    for j in range(70):
        angle = j * 2 * math.pi / 70
        direction = Vector((math.cos(angle), math.sin(angle), 0))
        start = direction * seam.uniform(.62, .84) + Vector((0, 0, seam.uniform(.12, .26)))
        end = direction * 1.06 + Vector((0, 0, .065))
        wood.limb(crooked_path(start, end, seam, .020), seam.uniform(.018, .036), j % 3, .02, j)
    for j in range(24):
        angle = j * 2 * math.pi / 24
        start = Vector((.62 * math.cos(angle), .62 * math.sin(angle), 2.89))
        end = Vector((.79 * math.cos(angle + .24), .79 * math.sin(angle + .24), 3.265 + .10 * math.sin(j * 2)))
        wood.limb(crooked_path(start, end, seam, .028), .029, j % 3, .02, j)

    for side in range(4):
        detail = random.Random(VARIANT_SEEDS[index] + side * 31)
        # Mild directional bias plus a wide random spread, not large signature
        # motifs. Each tile remains a natural heap of tiny broken branches.
        base_angle = (.80, 2.35, .20, 1.45)[index]
        clusters = [(detail.uniform(-.48, .48), detail.uniform(.55, 2.51)) for _ in range(4)]
        for j in range((248, 258, 250, 270)[index]):
            if j % 3 == 0:
                cx, cz = clusters[(j // 3) % len(clusters)]
                along = max(-.73, min(.73, detail.gauss(cx, .17)))
                z = max(.15, min(2.88, detail.gauss(cz, .26)))
            else:
                along, z = detail.uniform(-.73, .73), detail.uniform(.15, 2.89)
            angle = base_angle + detail.uniform(-1.12, 1.12)
            length = detail.uniform(.23, .69)
            travel, rise = math.cos(angle) * length, math.sin(angle) * length
            start = face_point(side, along, z, detail.uniform(.82, .91))
            end = face_point(side, max(-.78, min(.78, along + travel)),
                             max(.08, min(3.12, z + rise)), detail.uniform(.88, .96))
            points = crooked_path(start, end, detail, .037)
            radius = detail.uniform(.020, .042)
            material = 1 + j % 2
            wood.limb(points, radius, material, .025, j)
            # Offshoot positions and directions vary as well as the main stick.
            for k in ((1, 3) if j % 3 == 0 else (2,)):
                root = points[k]
                along_delta = detail.uniform(-.17, .17)
                fork = root + (face_point(side, along_delta, detail.uniform(.09, .23), .02))
                wood.limb([root, root.lerp(fork, .57), fork], radius * .42, material, .018, j + k)
        # Short random splinters fill local gaps without adding large branches.
        for j in range(75):
            along, z = detail.uniform(-.68, .68), detail.uniform(.18, 2.90)
            start = face_point(side, along, z, .96)
            end = face_point(side, along + detail.uniform(-.18, .18), z + detail.uniform(.07, .20), .98)
            wood.limb(crooked_path(start, end, detail, .022), detail.uniform(.009, .018), j % 3, .018, j)
    wood.finish(col, mats)
    return col


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    camera = kit.setup_scene()
    scene = bpy.context.scene
    for light in [o for o in scene.objects if o.type == "LIGHT"]:
        light.data.type = "SUN"
        light.data.color = (1, 1, 1)
        light.data.energy = 1.7 if light.name == "ColdShaftKey" else 1.1
        light.data.angle = .35 if light.name == "ColdShaftKey" else .6
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (.16, .16, .16, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .35
    mats = [bark_material("Dark wet root crevices", "#25251f", "#746e5a"),
            bark_material("Weathered grey brown wood", "#37382f", "#b0a182"),
            bark_material("Dry pale splinters", "#444334", "#b6a680")]
    walls = [build(i, mats) for i in range(4)]
    camera.name = "WallCamera_2to1"
    camera.data.ortho_scale = 5.25
    camera.location = (10, -10, 9.645)
    kit.look_at(camera, (0, 0, 1.48))
    kit.set_resolution(1024, 1024)
    ground = kit.projected((0, 0, 0), 1024, 1024)
    geos = []
    for i, col in enumerate(walls):
        for item in walls:
            kit.set_collection_visible(item, item is col)
        # Preserve the existing texture keys; only the visual design changes.
        key = "swamp_living_block_" + chr(97 + i)
        kit.render(OUT / (key + ".png"), 1024, 1024)
        source.depth(OUT / (key + "_depth.png"), 1024)
        geos.append({"key": key, "label": NAMES[i], "canvas": [1024, 1024], "groundCenter": ground,
                     "display": [260, 259], "footprint": [128, 64], "wallH": 132, "halfThick": 13})
    for i, col in enumerate(walls):
        kit.set_collection_visible(col, i == 0)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "swamp_deadwood_wall_kit.blend"))
    data = {"version": 4, "walls": geos, "source": "Native Blender tapered forked branch meshes and branch-local procedural PBR",
            "reference": "assets/terrain/swamp_wall_straight.png (visual reference only, no pixels reused)",
            "sharedStructure": "fine-twig inner fill and shared seam/contact twigs; four independently seeded short-twig faces; no coarse roots, logs or knots",
            "gateSource": "tools/ai-gen/_swamp_stone_wall_kit_20260830/geometry.json",
            "gatePolicy": "Accepted bilateral vine gate is read-only; no regeneration or replacement",
            "variantSeeds": VARIANT_SEEDS, "maxBaseTwigRadius": .042,
            "allowBlockFlipX": False, "blockVariantHashShift": 8}
    (OUT / "geometry.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("SWAMP_DEADWOOD_WALLS_RENDERED", OUT, flush=True)


if __name__ == "__main__":
    main()
