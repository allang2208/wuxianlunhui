"""Reusable restrained PBR materials for small environment props.

Native Blender only: continuous color patches, sparse grain, subtle normal detail.
No geometry, displacement, emission, floor, light, camera or runtime changes.
Existing maps are not regenerated when this library changes.
"""
VERSION = "environment-prop-pbr-v1"

# Linear shader colors. Values deliberately stay close within each material.
PRESETS = {
    "slate": dict(dark=(.095,.112,.129), light=(.15,.169,.185), rough=(.88,.97), metal=0, stretch=(3,3,8), scale=2.2, bump=.006),
    "slate_edge": dict(dark=(.145,.16,.175), light=(.19,.204,.215), rough=(.86,.96), metal=0, stretch=(3,3,8), scale=2.2, bump=.004),
    "coal": dict(dark=(.025,.030,.034), light=(.063,.072,.077), rough=(.63,.86), metal=.06, stretch=(2,2,3), scale=2.5, bump=.008),
    "ore": dict(dark=(.15,.182,.20), light=(.235,.27,.28), rough=(.66,.86), metal=.18, stretch=(2,2,4), scale=2.3, bump=.007),
    "mineral": dict(dark=(.25,.30,.29), light=(.33,.38,.355), rough=(.56,.75), metal=.32, stretch=(3,3,3), scale=2, bump=.003),
    "wood": dict(dark=(.115,.081,.050), light=(.205,.151,.097), rough=(.88,.98), metal=0, stretch=(.5,18,14), scale=3.5, bump=.008),
    "wood_handle": dict(dark=(.145,.101,.058), light=(.24,.176,.108), rough=(.84,.96), metal=0, stretch=(18,18,.5), scale=3.5, bump=.006),
    "wood_dark": dict(dark=(.065,.05,.035), light=(.11,.079,.05), rough=(.92,1), metal=0, stretch=(.5,18,14), scale=3.5, bump=.006),
    "iron": dict(dark=(.06,.073,.078), light=(.125,.143,.148), rough=(.62,.82), metal=.52, stretch=(2,2,2), scale=3.0, bump=.004),
    "rust": dict(dark=(.075,.054,.035), light=(.195,.115,.064), rough=(.85,.98), metal=.18, stretch=(2,2,2), scale=2.4, bump=.008),
    "rope": dict(dark=(.18,.148,.097), light=(.285,.237,.161), rough=(.91,.99), metal=0, stretch=(3,3,8), scale=3, bump=.004),
    "canvas": dict(dark=(.175,.16,.122), light=(.26,.241,.191), rough=(.93,1), metal=0, stretch=(3,3,3), scale=2, bump=.005),
    "helmet": dict(dark=(.16,.142,.087), light=(.24,.211,.128), rough=(.80,.95), metal=.08, stretch=(3,3,3), scale=2, bump=.004),
    "glass": dict(dark=(.095,.124,.125), light=(.16,.199,.197), rough=(.38,.55), metal=.10, stretch=(2,2,1), scale=2, bump=0),
}


def make_material(helpers, name, preset):
    """Uses the caller's material registry; no global Blender scene mutation."""
    p=PRESETS[preset]
    mat=helpers.material(name,p["light"],roughness=p["rough"][1],metallic=p["metal"])
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    bsdf=helpers.principled_bsdf(mat)
    coord=nodes.new("ShaderNodeTexCoord")
    stretch=nodes.new("ShaderNodeVectorMath"); stretch.operation="MULTIPLY"
    stretch.inputs[1].default_value=p["stretch"]
    noise=nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value=p["scale"]
    noise.inputs["Detail"].default_value=1.2
    noise.inputs["Roughness"].default_value=.55
    links.new(coord.outputs["Generated"],stretch.inputs[0])
    links.new(stretch.outputs["Vector"],noise.inputs["Vector"])
    color=nodes.new("ShaderNodeValToRGB")
    color.color_ramp.elements[0].position=.25
    color.color_ramp.elements[0].color=(*p["dark"],1)
    color.color_ramp.elements[1].position=.77
    color.color_ramp.elements[1].color=(*p["light"],1)
    links.new(noise.outputs["Fac"],color.inputs["Fac"])
    links.new(color.outputs["Color"],bsdf.inputs["Base Color"])
    rough=nodes.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value=p["rough"][0]
    rough.inputs["To Max"].default_value=p["rough"][1]
    links.new(noise.outputs["Fac"],rough.inputs["Value"])
    links.new(rough.outputs["Result"],bsdf.inputs["Roughness"])
    if p["bump"]:
        bump=nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value=.16
        bump.inputs["Distance"].default_value=p["bump"]
        links.new(noise.outputs["Fac"],bump.inputs["Height"])
        links.new(bump.outputs["Normal"],bsdf.inputs["Normal"])
    mat["environmentPropStyle"]=VERSION
    mat["preset"]=preset
    return mat


def apply_mine_palette(model):
    aliases={"mine_slate":"slate","mine_slate_light":"slate_edge","mine_coal":"coal",
             "mine_ore":"ore","mine_ore_glint":"mineral","mine_wood":"wood",
             "mine_wood_dark":"wood_dark","mine_iron":"iron","mine_rust":"rust",
             "mine_rope":"rope","mine_canvas":"canvas","mine_helmet":"helmet","mine_glass":"glass"}
    for name,preset in aliases.items():
        make_material(model.S,name,preset)
    return {"version":VERSION,"library":"tools/ai-gen/environment-prop-materials.py","palette":aliases,"presets":PRESETS,"aiRefinement":False}


def finish_mine_handles(model):
    """Cylinder handles need longitudinal Z grain; planks use X grain."""
    mat=make_material(model.S,"mine_wood_handle","wood_handle")
    for key,col in model.S.MODEL_COLLECTIONS.items():
        for obj in col.all_objects:
            if obj.name in {"Pick_wood_handle","Shovel_handle"}:
                obj.data.materials.clear()
                obj.data.materials.append(mat)
