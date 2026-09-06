"""Render a civilian variant of the accepted V2 native banner; no game execution.

The source blend and original ImageGen emblem are read-only inputs. The generated
emblem has an opaque neutral checkerboard; a native shader masks neutral pixels,
without rewriting its raster. Camera, mesh, UV, ink palette and light stay shared.
"""
from pathlib import Path
import json
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
BASE = REPO / 'tools/ai-gen/_world_army_flags_v2_20260830'
FRAME = 256

bpy.ops.wm.open_mainfile(filepath=str(BASE / 'world-army-flags-v2.blend'))
bpy.context.preferences.filepaths.save_version = 0
source = json.loads((BASE / 'manifest.json').read_text(encoding='utf-8'))
scene = bpy.context.scene
for profile in source['profiles']:
    collection = bpy.data.collections.get(profile['key'])
    if profile['key'] == 'player':
        collection.hide_render = collection.hide_viewport = False
        collection.name = 'settler'
    elif collection:
        for obj in list(collection.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(collection)

mat = bpy.data.materials['player matte woven cloth and printed heraldry']
mat.name = 'Settler home-and-leaves woven banner'
nodes, links = mat.node_tree.nodes, mat.node_tree.links
decal = nodes['Original fine heraldic artwork, unchanged']
decal.image = bpy.data.images.load(str(OUT / 'emblem-source.png'), check_existing=False)
decal.image.pack()
base = next(node for node in nodes if node.bl_idname == 'ShaderNodeValToRGB'
            and any(link.from_node.bl_idname == 'ShaderNodeTexNoise' for link in node.inputs['Fac'].links))
color = (.06, .145, .18)
base.color_ramp.elements[0].color = (*(c * .82 for c in color), 1)
base.color_ramp.elements[1].color = (*(c * 1.12 for c in color), 1)
# Neutral backdrop has R=B; warm engraving has R>B. Only the printed-ink mask
# changes. This is a shader on the native cloth, not offline PNG background editing.
separate = nodes.new('ShaderNodeSeparateColor'); separate.mode = 'RGB'
links.new(decal.outputs['Color'], separate.inputs['Color'])
warm = nodes.new('ShaderNodeMath'); warm.operation = 'SUBTRACT'
links.new(separate.outputs['Red'], warm.inputs[0]); links.new(separate.outputs['Blue'], warm.inputs[1])
mask = nodes.new('ShaderNodeMapRange'); mask.clamp = True
mask.inputs['From Min'].default_value = .008; mask.inputs['From Max'].default_value = .06
links.new(warm.outputs[0], mask.inputs['Value'])
mix = next(node for node in nodes if node.bl_idname == 'ShaderNodeMixRGB')
links.new(mask.outputs['Result'], mix.inputs[0])

scene.view_layers[0].material_override = None
scene.render.resolution_x = scene.render.resolution_y = FRAME
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = True
scene.cycles.samples = 64; scene.cycles.use_denoising = True
scene.cycles.device = 'CPU'; scene.render.threads_mode = 'FIXED'; scene.render.threads = 8
bpy.context.view_layer.update()
anchor = world_to_camera_view(scene, scene.camera, Vector((0, .035, 0)))
# Remove only orphan datablocks in this in-memory derivative, never the source file.
bpy.ops.outliner.orphans_purge(do_recursive=True)
scene.render.filepath = str(OUT / 'settler-flag.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'settler-flag.blend'))
bpy.ops.render.render(write_still=True)
render = bpy.data.images.load(str(OUT / 'settler-flag.png'), check_existing=False)
pixels = list(render.pixels)
points = [(i % FRAME, FRAME - 1 - i // FRAME) for i in range(FRAME * FRAME) if pixels[i * 4 + 3] > 0]
xs, ys = zip(*points)
metadata = dict(path='assets/ui/world-map/settler-flag.png', frameSize=FRAME,
                anchor=[anchor.x, 1-anchor.y],
                bounds=[min(xs)/FRAME, min(ys)/FRAME, (max(xs)+1)/FRAME, (max(ys)+1)/FRAME],
                camera={**source['camera'], 'resolution': FRAME},
                modelPose=source['modelPose'], label='移民队')
(OUT / 'settler-flag.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print('SETTLER_FLAG_RENDERED', json.dumps(metadata, ensure_ascii=False), flush=True)
