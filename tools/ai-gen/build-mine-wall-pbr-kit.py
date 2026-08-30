"""Shared modeled A/B/C wall candidates; AI supplies only a flat color map.

All world pixels, lighting, masks and depth are rendered in Blender. The image
map is mirrored periodically in the shader at the authored placement pitch;
its original opposite image edges need not be assumed pixel-identical.
"""
import importlib.util
import json
import math
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
OUT = HERE / "_mine_wall_pbr_kit_20260830"
spec = importlib.util.spec_from_file_location("wall_base",HERE/"build-mine-wall-a-rockface.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
kit = base.kit


def mapped_stone(top=False):
    mat = base.rock_material()
    mat.name = "Shared slate albedo / " + ("crown" if top else "cut faces")
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = "RockPeriod"
    axes = nodes.new("ShaderNodeSeparateXYZ")
    links.new(uv.outputs["UV"],axes.inputs[0])
    vector = nodes.new("ShaderNodeCombineXYZ")
    for index in range(2):
        if index == 0 or top:
            double = nodes.new("ShaderNodeMath")
            double.operation = "MULTIPLY"
            double.inputs[1].default_value = 2
            links.new(axes.outputs[index],double.inputs[0])
            fold = nodes.new("ShaderNodeMath")
            fold.operation = "PINGPONG"
            fold.inputs[1].default_value = 1
            links.new(double.outputs[0],fold.inputs[0])
            links.new(fold.outputs[0],vector.inputs[index])
        else:
            links.new(axes.outputs[index],vector.inputs[index])
    image = nodes.new("ShaderNodeTexImage")
    image.image = bpy.data.images.load(str(OUT/"slate_albedo_imagegen.png"),check_existing=True)
    image.image.pack()
    image.extension = "EXTEND"
    image.interpolation = "Linear"
    links.new(vector.outputs[0],image.inputs[0])
    # The flat map is used for color only, not displacement, camera, shadows
    # or alpha. Moderate its photographed fine detail against a calm slate.
    mix = nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MIX"
    mix.inputs[0].default_value = .76 if not top else .60
    mix.inputs[1].default_value = base.linear_hex("#656a6c")
    links.new(image.outputs["Color"],mix.inputs[2])
    links.new(mix.outputs[0],nodes.get("Principled BSDF").inputs["Base Color"])
    return mat


def set_uv(obj, side=None):
    layer=obj.data.uv_layers.new(name="RockPeriod")
    for loop in obj.data.loops:
        v=obj.data.vertices[loop.vertex_index].co
        if side is None:
            uv=(v.x/base.PITCH+.5,v.y/base.PITCH+.5)
        else:
            along=(v.x,v.y,-v.x,-v.y)[side]
            uv=(along/base.PITCH+.5,v.z/base.H)
        layer.data[loop.index].uv=uv


def duplicate_base(source, name):
    result=bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(result)
    for obj in source.objects:
        clone=obj.copy()
        clone.data=obj.data  # Geometry/UV/material are identical across variants.
        result.objects.link(clone)
    return result


def close_rock_corners(collection):
    # The baseline's displaced faces stopped at the undisplaced core edge.
    # That exposed a thin strip of core at every corner. Extend each face to
    # its neighbour's relief edge, with identical meeting vertices at each z.
    # Bounds, the solid core, crown, anchor and placement pitch stay unchanged.
    for obj in collection.objects:
        if not obj.name.startswith("Continuous cleavage face"):
            continue
        side = int(obj.name.rsplit(" ",1)[-1])
        angle = side * math.pi / 2
        c, s = math.cos(angle), math.sin(angle)
        for vertex in obj.data.vertices:
            u = (vertex.index % 81) / 80
            v = vertex.co
            x, y, z = v.x*c + v.y*s, -v.x*s + v.y*c, v.z
            x += base.relief(0,z)*base.smooth((u-.84)/.16)
            x -= base.relief(1,z)*base.smooth((.16-u)/.16)
            vertex.co = (x*c-y*s, x*s+y*c, z)
        obj.data.update()


def seam_curve(points, width, material, collection, name):
    curve=bpy.data.curves.new(name,"CURVE")
    curve.dimensions="3D"
    curve.bevel_depth=width
    curve.bevel_resolution=1
    line=curve.splines.new("POLY")
    line.points.add(len(points)-1)
    for dst,(x,z) in zip(line.points,points):
        # Follow the fixed rock surface rather than float over its recesses.
        y=-1.06-base.relief(x/2.12+.5,z)-.011
        dst.co=(x,y,z,1)
    obj=bpy.data.objects.new(name,curve)
    collection.objects.link(obj)
    curve.materials.append(material)
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)


def ore_variant(collection):
    ore=kit.plain_material("Muted non-emissive iron ore", "#505150", .76,.26)
    ore.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value=base.linear_hex("#737873")
    seam_curve([(-.49,.63),(-.35,.93),(-.39,1.16),(-.18,1.43),(-.06,1.68),(.13,1.94),(.08,2.23)],.016,ore,collection,"Sparse iron seam")
    seam_curve([(-.18,1.43),(.05,1.46),(.22,1.61),(.43,1.64)],.010,ore,collection,"Short mineral branch")


def wood_variant(collection):
    wood=kit.noisy_material("Shared aged oak", "#25221e", "#4b4033", 3.0,.13,.89)
    # Use object coordinates stretched across the grain; broad wear remains
    # subordinate to structural braces at the final sprite display size.
    wood_noise=next(n for n in wood.node_tree.nodes if n.type=="TEX_NOISE")
    mapping=wood.node_tree.nodes.new("ShaderNodeVectorMath")
    mapping.operation="MULTIPLY"
    mapping.inputs[1].default_value=(5,5,.22)
    coord=wood.node_tree.nodes.new("ShaderNodeTexCoord")
    wood.node_tree.links.new(coord.outputs["Object"],mapping.inputs[0])
    wood.node_tree.links.new(mapping.outputs[0],wood_noise.inputs["Vector"])
    iron=kit.plain_material("Shared oxidized iron bands", "#25292c", .78,.35)
    for x in (-.67,.67):
        kit.cube("Embedded pit prop",(x,-1.19,1.48),(.15,.12,2.68),wood,.013,collection)
        for z in (.40,2.54):
            kit.cube("Restrained iron collar",(x,-1.262,z),(.17,.018,.075),iron,.003,collection)
    kit.cube("Front lintel within crown",(0,-1.20,2.76),(1.50,.15,.15),wood,.015,collection)
    kit.beam_between("Short diagonal brace",(-.65,-1.25,.62),(.59,-1.25,2.44),.11,.095,wood,collection)
    kit.cube("Side pit prop",(1.20,.64,1.46),(.13,.15,2.64),wood,.013,collection)
    kit.cube("Side lintel",(1.20,0,2.76),(.15,1.48,.15),wood,.015,collection)


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    camera=kit.setup_scene()
    scene=bpy.context.scene
    for obj in scene.objects:
        if obj.type=="LIGHT":
            obj.data.color=(1,1,1)
            obj.data.type="SUN"
            obj.data.energy=1.8 if obj.name=="ColdShaftKey" else 1.2
            obj.data.angle=.30 if obj.name=="ColdShaftKey" else .60
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value=(.16,.16,.16,1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value=.35
    camera.data.ortho_scale=5.25
    camera.location=(10,-10,9.645)
    kit.look_at(camera,(0,0,1.48))
    kit.set_resolution(1024,1024)
    base.build_rock(base.rock_material())
    a=bpy.data.collections["A_continuous_bedrock_SHARED_FOR_FUTURE_B_C"]
    a.name="A_plain_continuous_slate"
    close_rock_corners(a)
    face_mat,top_mat=mapped_stone(),mapped_stone(True)
    for obj in a.objects:
        if obj.name.startswith("Continuous cleavage face"):
            side=int(obj.name.rsplit(" ",1)[-1])
            set_uv(obj,side)
            obj.data.materials[0]=face_mat
        elif obj.name.startswith("Joined crown"):
            set_uv(obj)
            obj.data.materials[0]=top_mat
    b=duplicate_base(a,"B_sparse_mineral_seam")
    c=duplicate_base(a,"C_occasional_timber_support")
    bpy.ops.object.select_all(action="DESELECT")
    ore_variant(b)
    wood_variant(c)
    variants=[a,b,c]
    for index,col in enumerate(variants):
        for other in variants:
            kit.set_collection_visible(other,other==col)
        # A/B/C beauty all use precisely the same material and neutral lights.
        scene.view_settings.view_transform="AgX"
        scene.view_settings.look="AgX - Medium High Contrast"
        scene.render.image_settings.color_mode="RGBA"
        scene.render.image_settings.color_depth="8"
        suffix="abc"[index]
        kit.render(OUT/f"wall_{suffix}.png",1024,1024)
        scene.view_settings.view_transform="Raw"
        scene.view_settings.look="None"
        scene.render.image_settings.color_mode="BW"
        scene.render.image_settings.color_depth="16"
        kit.render_depth(OUT/f"wall_{suffix}_body_depth.png",1024,1024)
    for col in variants:
        kit.set_collection_visible(col,col==a)
    scene.view_settings.view_transform="AgX"
    scene.view_settings.look="AgX - Medium High Contrast"
    scene.render.image_settings.color_mode="RGBA"
    scene.render.image_settings.color_depth="8"
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"mine_wall_pbr_kit.blend"))
    geo=json.loads((HERE/"_mine_wall_a_rockface_20260830/geometry.json").read_text(encoding="utf-8"))
    geo["variants"]=["a","b","c"]
    geo["materialMapping"]="shared flat AI albedo / mirrored shader period / native Blender lighting"
    geo["seamContract"]["joinedReliefCorners"] = True
    (OUT/"geometry.json").write_text(json.dumps(geo,ensure_ascii=False,indent=2),encoding="utf-8")
    print("CANDIDATE_ONLY",OUT,flush=True)


if __name__=="__main__":
    main()
