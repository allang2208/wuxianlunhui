"""Shared baked strategic-map camera. Tactical maps use separate projections.

The installed terrain layout is the elevation authority used by WorldMapView.
Azimuth and roll are fixed: +X right, +Y north, +Z up; camera south of target.
Changing this contract requires re-rendering terrain AND map props, not merely
changing a Canvas projection or stretching previously rendered PNGs.
Cloth may retain its user-selected readable pose; camera agreement does not
require every prop surface to be vertical (see docs/world-map-camera.md).
"""
from pathlib import Path
import json
import math

REPO = Path(__file__).resolve().parents[2]
LAYOUT_PATH = 'data/world-map-layout.json'
ELEVATION_DEGREES = json.loads((REPO / LAYOUT_PATH).read_text(encoding='utf-8'))['cameraElevationDegrees']
CONTRACT = dict(
    projection='orthographic',
    elevationDegrees=ELEVATION_DEGREES,
    elevationReference='above XY ground plane; 90 degrees is top-down',
    azimuthDegrees=0,
    azimuthReference='from -Y toward +X; camera on -Y looking toward +Y',
    rollDegrees=0,
    worldUp='+Z',
    source=LAYOUT_PATH,
)


def create_camera(scene, name, target, ortho_scale):
    import bpy
    from mathutils import Vector

    target = Vector(target)
    elevation = math.radians(ELEVATION_DEGREES)
    data = bpy.data.cameras.new(name)
    data.type = 'ORTHO'
    data.ortho_scale = ortho_scale
    camera = bpy.data.objects.new(name, data)
    scene.collection.objects.link(camera)
    camera.location = target + Vector((0, -12 * math.cos(elevation), 12 * math.sin(elevation)))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    return camera
