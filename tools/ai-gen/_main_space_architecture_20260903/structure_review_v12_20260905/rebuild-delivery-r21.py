"""Rebuild final R21 layers/paving from the retained packed scene (Blender)."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
BASE=Path(__file__).resolve().parent;OUT=BASE/'delivery_r21';RAW=OUT/'raw';RAW.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(OUT/'main-hub-r21-stone.blend'))
scene=bpy.context.scene;camera=scene.camera
objects=[o for o in bpy.data.collections['V12_EDITABLE_STRUCTURE_PROPOSAL'].objects if o.type=='MESH']
plaza=bpy.data.objects['R17_PlazaGround'];material=bpy.data.materials['R20_PlazaMicroPolished']
scene.render.resolution_x=3072;scene.render.resolution_y=1728;scene.render.resolution_percentage=100
scene.render.film_transparent=True;scene.cycles.samples=128;scene.cycles.use_denoising=True
# Reuse the complete R18 ownership list, including R12/R13 surface details.
ownership=json.loads((OUT/'layer-manifest.json').read_text(encoding='utf-8'))
casters=bpy.data.collections.new('R21_BaseSelfShadowCasters')
for o in objects:
 if o.get('v12_group')=='bases' and not o.name.startswith('R12_Dais'):casters.objects.link(o)
records=[];plaza.hide_render=True
scene.render.use_border=True;scene.render.use_crop_to_border=True
for entry in ownership['layers']:
 name=entry['id'];selected=[bpy.data.objects[key] for key in entry['objects']]
 for o in objects:o.visible_camera=True;o.is_holdout=o not in selected;o.hide_render=False
 for o in scene.objects:
  if o.type=='LIGHT':o.light_linking.blocker_collection=casters if name=='terrace' else None
 coords=[world_to_camera_view(scene,camera,o.matrix_world@Vector(v)) for o in selected for v in o.bound_box]
 x0=max(0,math.floor(min(p.x for p in coords)*3072)-8);x1=min(3072,math.ceil(max(p.x for p in coords)*3072)+8)
 y0=max(0,math.floor((1-max(p.y for p in coords))*1728)-8);y1=min(1728,math.ceil((1-min(p.y for p in coords))*1728)+8)
 scene.render.border_min_x=x0/3072;scene.render.border_max_x=x1/3072
 scene.render.border_min_y=1-y1/1728;scene.render.border_max_y=1-y0/1728
 scene.render.filepath=str(RAW/(name+'.png'));print('R21_LAYER '+name,flush=True);bpy.ops.render.render(write_still=True)
 records.append(dict(id=name,file=name+'.png',canvasCrop=[x0,y0,x1,y1],objects=entry['objects']))
(OUT/'layer-manifest.json').write_text(json.dumps(dict(source='main-hub-r21-stone.blend',renderSize=[3072,1728],samples=128,layers=records,
 geometryChanged=False,occlusion='camera holdout and R18 semantic owners'),ensure_ascii=False,indent=2),encoding='utf-8')

for o in objects:o.hide_render=True
period=math.sqrt(2)*256*8;pixels=2896;center=Vector((-6144+period/2,8192-period/2,0))
tile=bpy.data.objects.new('R21_PeriodicPavingCapture',bpy.data.meshes.new('R21_PeriodicPavingMesh'));scene.collection.objects.link(tile)
tile.data.from_pydata([(center.x-period,center.y-period,0),(center.x+period,center.y-period,0),
 (center.x+period,center.y+period,0),(center.x-period,center.y+period,0)],[],[(0,1,2,3)]);tile.data.update();tile.data.materials.append(material)
camera.location=center+Vector((0,-5000,5000/math.sqrt(3)));camera.rotation_euler=(math.pi/3,0,0);camera.data.ortho_scale=period
scene.render.use_border=False;scene.render.use_crop_to_border=False;scene.render.resolution_x=pixels;scene.render.resolution_y=pixels//2
for o in scene.objects:
 if o.type=='LIGHT':o.light_linking.blocker_collection=None
scene.render.filepath=str(RAW/'plaza-periodic-projected.png');print('R21_PERIODIC_PAVING',flush=True);bpy.ops.render.render(write_still=True)
(OUT/'paving-manifest.json').write_text(json.dumps(dict(material=material.name,runtimeWorldPeriod=[2896,1448],sourceWorldPeriod=period,
 worldOriginPhase=[0,0],groundProjectionY=.5,periodicColorCells=8,quarterTurnMineralSamples=True,
 reflection='uniform angular sky source; no repeated local area-light patch',microBumpPeriodic=True,
 existing5080Seed=906514,newAiGenerations=0),indent=2),encoding='utf-8')
