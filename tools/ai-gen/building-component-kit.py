#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Reusable Blender components for World-122 strategy-game buildings.

The helpers deliberately create named, editable objects instead of joining the
mesh.  A generated .blend can therefore donate doors, windows, roof rows,
lanterns, gears, benches and chimneys to later buildings.
"""

import math

import bpy
import mathutils


def rgba(values):
    return tuple(float(value) for value in values)


def move_to_collection(obj, collection):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    collection.objects.link(obj)


def material(name, color, roughness=0.75, metallic=0.0, noise=None, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission[0]
        bsdf.inputs["Emission Strength"].default_value = emission[1]
    if noise:
        tex = nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = noise.get("scale", 5.0)
        tex.inputs["Detail"].default_value = noise.get("detail", 3.0)
        tex.inputs["Roughness"].default_value = noise.get("roughness", 0.65)
        ramp = nodes.new("ShaderNodeValToRGB")
        dark = noise.get("dark", tuple(max(0.0, c * 0.72) for c in color[:3]) + (1.0,))
        light = noise.get("light", tuple(min(1.0, c * 1.16) for c in color[:3]) + (1.0,))
        ramp.color_ramp.elements[0].color = dark
        ramp.color_ramp.elements[1].color = light
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = noise.get("bump", 0.18)
        bump.inputs["Distance"].default_value = noise.get("distance", 0.16)
        links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
        links.new(tex.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def bevel(obj, width=1.5, segments=2):
    if width > 0:
        modifier = obj.modifiers.new(name="Edge_Soften", type="BEVEL")
        modifier.width = width
        modifier.segments = segments
    return obj


def box(collection, parent, name, size, location, mat, rotation=(0, 0, 0), bevel_width=1.2):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = tuple(float(value) for value in size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.parent = parent
    obj.location = location
    obj.rotation_euler = tuple(math.radians(value) for value in rotation)
    obj.data.materials.append(mat)
    bevel(obj, bevel_width, 3 if bevel_width >= 2 else 2)
    move_to_collection(obj, collection)
    return obj


def cylinder(collection, parent, name, radius, depth, location, mat,
             rotation=(0, 0, 0), vertices=48, bevel_width=0.8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = location
    obj.rotation_euler = tuple(math.radians(value) for value in rotation)
    obj.data.materials.append(mat)
    bevel(obj, bevel_width, 2)
    move_to_collection(obj, collection)
    return obj


def torus_ring(collection, parent, name, major_radius, minor_radius, location,
               mat, rotation=(0, 0, 0), major_segments=64,
               minor_segments=12, smooth=True):
    """Complete editable torus ring for attached energy and resonator hardware."""
    bpy.ops.mesh.primitive_torus_add(
        major_radius=float(major_radius), minor_radius=float(minor_radius),
        major_segments=int(major_segments), minor_segments=int(minor_segments))
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = location
    obj.rotation_euler = tuple(math.radians(value) for value in rotation)
    obj.data.materials.append(mat)
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    move_to_collection(obj, collection)
    return obj


def rough_boulder(collection, parent, name, size, location, mat,
                  rotation=(0, 0, 0), subdivisions=2):
    """Low-poly editable boulder for natural foundations and resource piles."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = tuple(float(value) for value in size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.parent = parent
    obj.location = location
    obj.rotation_euler = tuple(math.radians(value) for value in rotation)
    obj.data.materials.append(mat)
    move_to_collection(obj, collection)
    return obj


def faceted_crystal_prism(collection, parent, name, height, radius, location, mat,
                          highlight_mat=None, lean=(0, 0), sides=6,
                          depth_scale=0.78, rotation_z=0):
    """Pointed faceted crystal with an embedded flat base and editable side faces."""
    count = max(4, int(sides))
    shoulder_z = float(height) * 0.78
    lean_x, lean_y = (float(value) for value in lean)
    rot = math.radians(float(rotation_z))
    vertices = []
    for z, offset_x, offset_y in ((0.0, 0.0, 0.0),
                                  (shoulder_z, lean_x * 0.78, lean_y * 0.78)):
        for index in range(count):
            angle = math.tau * index / count + rot
            vertices.append((
                math.cos(angle) * radius + offset_x,
                math.sin(angle) * radius * depth_scale + offset_y,
                z,
            ))
    apex_index = len(vertices)
    vertices.append((lean_x, lean_y, float(height)))
    faces = [tuple(reversed(range(count)))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
        faces.append((count + index, count + nxt, apex_index))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    if highlight_mat is not None:
        mesh.materials.append(highlight_mat)
        for index, polygon in enumerate(mesh.polygons[1:], 1):
            polygon.material_index = 1 if index % 3 == 1 else 0
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    bevel(obj, max(0.7, float(radius) * 0.025), 2)
    return obj


def gabled_prism(collection, parent, name, length, width, roof_height, location,
                  gable_mat, roof_mat):
    half_l, half_w = length / 2, width / 2
    vertices = [
        (-half_l, -half_w, 0), (-half_l, half_w, 0), (-half_l, 0, roof_height),
        (half_l, -half_w, 0), (half_l, half_w, 0), (half_l, 0, roof_height),
    ]
    faces = [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (0, 3, 5, 2)]
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(gable_mat)
    mesh.materials.append(roof_mat)
    for index, polygon in enumerate(mesh.polygons):
        polygon.material_index = 1 if index >= 3 else 0
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    bevel(obj, 1.5, 2)
    return obj


def barrel_vault(collection, parent, name, length, width, height, location,
                 end_mat, roof_mat, segments=28):
    """Closed half-elliptic barrel vault with separate end and curved materials.

    The vault runs along local X; ``width`` spans local Y and ``height`` rises
    from the flat spring line.  It is suitable for compact storehouses, chapel
    roofs and chest-like masonry caps while keeping every mesh editable.
    """
    half_l = float(length) / 2
    half_w = float(width) / 2
    height = float(height)
    segment_count = max(8, int(segments))
    vertices = []
    left_ring = []
    right_ring = []
    for index in range(segment_count + 1):
        angle = math.pi * index / segment_count
        y = half_w * math.cos(angle)
        z = height * math.sin(angle)
        left_ring.append(len(vertices))
        vertices.append((-half_l, y, z))
        right_ring.append(len(vertices))
        vertices.append((half_l, y, z))
    left_center = len(vertices)
    vertices.append((-half_l, 0, 0))
    right_center = len(vertices)
    vertices.append((half_l, 0, 0))

    faces = []
    material_indices = []
    for index in range(segment_count):
        nxt = index + 1
        faces.append((left_ring[index], right_ring[index], right_ring[nxt], left_ring[nxt]))
        material_indices.append(1)
    for index in range(segment_count):
        nxt = index + 1
        faces.append((left_center, left_ring[nxt], left_ring[index]))
        material_indices.append(0)
        faces.append((right_center, right_ring[index], right_ring[nxt]))
        material_indices.append(0)
    faces.append((left_ring[0], left_ring[-1], right_ring[-1], right_ring[0]))
    material_indices.append(0)

    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(end_mat)
    mesh.materials.append(roof_mat)
    for polygon, material_index in zip(mesh.polygons, material_indices):
        polygon.material_index = material_index
        if material_index == 1:
            polygon.use_smooth = True
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    bevel(obj, 1.2, 2)
    return obj


def roof_rows(collection, parent, name, length, width, roof_height, base_z, mat,
              rows=11, center=(0, 0)):
    """Add editable overlapping courses on both slopes of a gabled roof."""
    center_x, center_y = center
    slope_angle = math.degrees(math.atan2(roof_height, width / 2))
    for side in (-1, 1):
        for index in range(rows):
            t = (index + 0.52) / rows
            y = center_y + side * (width / 2) * (1 - t)
            z = base_z + roof_height * t + 2.0
            box(collection, parent, f"{name}_S{side:+d}_Row_{index + 1:02d}",
                (length + 5, width / rows + 4, 4.5),
                (center_x, y, z), mat,
                rotation=(-side * slope_angle, 0, 0), bevel_width=0.7)


def half_timber_facade(collection, parent, name, width, height, y, base_z, timber,
                       bays=4, include_braces=True):
    box(collection, parent, name + "_BottomBand", (width + 8, 8, 10), (0, y, base_z + 5), timber)
    box(collection, parent, name + "_TopBand", (width + 8, 8, 10), (0, y, base_z + height - 5), timber)
    step = width / bays
    for index in range(bays + 1):
        x = -width / 2 + index * step
        box(collection, parent, f"{name}_Post_{index:02d}", (9, 8, height),
            (x, y, base_z + height / 2), timber)
    if include_braces:
        for index in range(bays):
            x = -width / 2 + (index + 0.5) * step
            angle = 38 if index % 2 == 0 else -38
            box(collection, parent, f"{name}_Brace_{index:02d}", (step * 0.78, 7, 8),
                (x, y - 1, base_z + height * 0.35), timber, rotation=(0, angle, 0), bevel_width=0.6)


def half_timber_side(collection, parent, name, depth, height, x, base_z, timber, bays=3):
    box(collection, parent, name + "_BottomBand", (8, depth + 8, 10), (x, 0, base_z + 5), timber)
    box(collection, parent, name + "_TopBand", (8, depth + 8, 10), (x, 0, base_z + height - 5), timber)
    step = depth / bays
    for index in range(bays + 1):
        y = -depth / 2 + index * step
        box(collection, parent, f"{name}_Post_{index:02d}", (8, 9, height),
            (x, y, base_z + height / 2), timber)
    for index in range(bays):
        y = -depth / 2 + (index + 0.5) * step
        angle = 38 if index % 2 == 0 else -38
        box(collection, parent, f"{name}_Brace_{index:02d}", (7, step * 0.78, 8),
            (x - 1, y, base_z + height * 0.35), timber, rotation=(angle, 0, 0), bevel_width=0.6)


def shutter_window(collection, parent, name, location, glass, timber, iron,
                   orientation="front", scale=1.0):
    x, y, z = location
    if orientation == "front":
        box(collection, parent, name + "_Frame", (54 * scale, 8, 68 * scale), (x, y, z), timber, bevel_width=2)
        box(collection, parent, name + "_Glass", (42 * scale, 5, 56 * scale), (x, y - 5, z), glass, bevel_width=1)
        box(collection, parent, name + "_MullionV", (4, 4, 52 * scale), (x, y - 8, z), iron, bevel_width=0.3)
        box(collection, parent, name + "_MullionH", (38 * scale, 4, 4), (x, y - 8, z), iron, bevel_width=0.3)
        for side in (-1, 1):
            sx = x + side * 39 * scale
            box(collection, parent, f"{name}_Shutter_{side:+d}", (22 * scale, 5, 62 * scale),
                (sx, y - 2, z), timber, rotation=(0, 0, side * 7), bevel_width=1.5)
            for row in (-18, 0, 18):
                box(collection, parent, f"{name}_ShutterBand_{side:+d}_{row:+d}",
                    (19 * scale, 3, 3), (sx, y - 6, z + row * scale), iron, bevel_width=0.3)
    else:
        box(collection, parent, name + "_Frame", (8, 54 * scale, 68 * scale), (x, y, z), timber, bevel_width=2)
        box(collection, parent, name + "_Glass", (5, 42 * scale, 56 * scale), (x - 5, y, z), glass, bevel_width=1)
        box(collection, parent, name + "_MullionV", (4, 4, 52 * scale), (x - 8, y, z), iron, bevel_width=0.3)
        box(collection, parent, name + "_MullionH", (4, 38 * scale, 4), (x - 8, y, z), iron, bevel_width=0.3)


def framed_glass_panel(collection, parent, name, location, width, height,
                       glass, frame_mat, trim_mat, *, orientation="front",
                       vertical_divisions=2, horizontal_divisions=2,
                       horizontal_bias=0.0, ornaments=False, depth=9.0):
    """Large editable commercial/office glazing with parameterized divisions.

    ``orientation`` follows the same front/side convention as ``shutter_window``.
    Division counts describe the number of glass bays, not the number of mullions.
    ``horizontal_bias`` shifts the single transom used by a two-row panel, allowing
    storefront glazing to retain an intentionally asymmetric upper pane.
    """
    x, y, z = location
    width = float(width)
    height = float(height)
    depth = float(depth)
    vertical_divisions = max(1, int(vertical_divisions))
    horizontal_divisions = max(1, int(horizontal_divisions))
    frame = max(7.0, width * 0.08)

    if orientation == "front":
        box(collection, parent, name + "_Glass", (width, depth, height),
            (x, y, z), glass, bevel_width=2)
        for side in (-1, 1):
            box(collection, parent, f"{name}_FrameJamb_{side:+d}",
                (frame, depth + 5, height + frame * 2),
                (x + side * (width / 2 + frame / 2), y, z),
                frame_mat, bevel_width=1.5)
        for level in (-1, 1):
            box(collection, parent, f"{name}_FrameRail_{level:+d}",
                (width + frame * 2, depth + 5, frame),
                (x, y, z + level * (height / 2 + frame / 2)),
                frame_mat, bevel_width=1.5)
        for index in range(1, vertical_divisions):
            offset = -width / 2 + width * index / vertical_divisions
            box(collection, parent, f"{name}_TrimMullionV_{index:02d}",
                (frame * 0.48, depth + 7, height), (x + offset, y - 1, z),
                trim_mat, bevel_width=0.8)
        for index in range(1, horizontal_divisions):
            offset = -height / 2 + height * index / horizontal_divisions
            if horizontal_divisions == 2:
                offset += height * float(horizontal_bias)
            box(collection, parent, f"{name}_TrimMullionH_{index:02d}",
                (width, depth + 7, frame * 0.48), (x, y - 1, z + offset),
                trim_mat, bevel_width=0.8)
        if ornaments:
            for index, (rx, rz) in enumerate(((-0.29, -0.29), (0.29, -0.29),
                                               (-0.29, 0.31), (0.29, 0.31))):
                cylinder(collection, parent, f"{name}_TrimRosette_{index}",
                    frame * 0.46, depth + 9,
                    (x + width * rx, y - 2, z + height * rz), trim_mat,
                    rotation=(90, 0, 0), vertices=12, bevel_width=0.5)
    else:
        box(collection, parent, name + "_Glass", (depth, width, height),
            (x, y, z), glass, bevel_width=2)
        for side in (-1, 1):
            box(collection, parent, f"{name}_FrameJamb_{side:+d}",
                (depth + 5, frame, height + frame * 2),
                (x, y + side * (width / 2 + frame / 2), z),
                frame_mat, bevel_width=1.5)
        for level in (-1, 1):
            box(collection, parent, f"{name}_FrameRail_{level:+d}",
                (depth + 5, width + frame * 2, frame),
                (x, y, z + level * (height / 2 + frame / 2)),
                frame_mat, bevel_width=1.5)
        for index in range(1, vertical_divisions):
            offset = -width / 2 + width * index / vertical_divisions
            box(collection, parent, f"{name}_TrimMullionV_{index:02d}",
                (depth + 7, frame * 0.48, height), (x - 1, y + offset, z),
                trim_mat, bevel_width=0.8)
        for index in range(1, horizontal_divisions):
            offset = -height / 2 + height * index / horizontal_divisions
            if horizontal_divisions == 2:
                offset += height * float(horizontal_bias)
            box(collection, parent, f"{name}_TrimMullionH_{index:02d}",
                (depth + 7, width, frame * 0.48), (x - 1, y, z + offset),
                trim_mat, bevel_width=0.8)


def solar_panel_array(collection, parent, name, location, rows, columns,
                      panel_size, panel_mat, frame_mat, *, row_gap=24.0,
                      column_gap=20.0, tilt_degrees=14.0,
                      support_height=54.0, support_mat=None):
    """Create an ordered, editable photovoltaic module array.

    ``location`` is the center of the array at its mounting plane. Positive
    ``tilt_degrees`` lowers the local negative-Y edge so every ground and roof
    array shares one readable sun-facing pitch. Each module, perimeter rail,
    cell divider and four support posts stays independently editable.
    """
    center_x, center_y, base_z = (float(value) for value in location)
    panel_w, panel_d, panel_t = (float(value) for value in panel_size)
    rows = max(1, int(rows))
    columns = max(1, int(columns))
    row_gap = float(row_gap)
    column_gap = float(column_gap)
    tilt = math.radians(float(tilt_degrees))
    support_height = max(8.0, float(support_height))
    support_mat = support_mat or frame_mat
    array_w = columns * panel_w + (columns - 1) * column_gap
    array_d = rows * panel_d + (rows - 1) * row_gap
    panel_center_z = base_z + support_height
    rotation = (float(tilt_degrees), 0, 0)

    def local_surface(center, local_y, local_z):
        px, py, pz = center
        return (
            px,
            py + local_y * math.cos(tilt) - local_z * math.sin(tilt),
            pz + local_y * math.sin(tilt) + local_z * math.cos(tilt),
        )

    modules = []
    for row in range(rows):
        for column in range(columns):
            panel_x = center_x - array_w / 2 + panel_w / 2 + column * (panel_w + column_gap)
            panel_y = center_y - array_d / 2 + panel_d / 2 + row * (panel_d + row_gap)
            panel_center = (panel_x, panel_y, panel_center_z)
            prefix = f"{name}_R{row + 1:02d}_C{column + 1:02d}"
            panel = box(
                collection, parent, prefix + "_PhotovoltaicModule",
                (panel_w, panel_d, panel_t), panel_center, panel_mat,
                rotation=rotation, bevel_width=2)
            modules.append(panel)

            rail_z = panel_t / 2 + 2.2
            for side in (-1, 1):
                box(
                    collection, parent, f"{prefix}_SideFrame_{side:+d}",
                    (7, panel_d + 8, 5),
                    local_surface(
                        (panel_x + side * (panel_w / 2 + 1.5), panel_y, panel_center_z),
                        0, rail_z),
                    frame_mat, rotation=rotation, bevel_width=0.8)
                edge_location = local_surface(
                    panel_center, side * (panel_d / 2 + 1.5), rail_z)
                box(
                    collection, parent, f"{prefix}_FrontBackFrame_{side:+d}",
                    (panel_w + 8, 7, 5), edge_location, frame_mat,
                    rotation=rotation, bevel_width=0.8)

            box(
                collection, parent, prefix + "_CellDivider_Longitudinal",
                (3, panel_d - 6, 2.4),
                local_surface(panel_center, 0, rail_z + 0.8), frame_mat,
                rotation=rotation, bevel_width=0.4)
            box(
                collection, parent, prefix + "_CellDivider_Transverse",
                (panel_w - 6, 3, 2.4),
                local_surface(panel_center, 0, rail_z + 0.8), frame_mat,
                rotation=rotation, bevel_width=0.4)

            for x_side in (-1, 1):
                for y_side in (-1, 1):
                    local_y = y_side * panel_d * 0.30
                    top = local_surface(panel_center, local_y, -panel_t / 2)
                    post_height = max(6.0, top[2] - base_z)
                    box(
                        collection, parent,
                        f"{prefix}_Support_{x_side:+d}_{y_side:+d}",
                        (5, 5, post_height),
                        (panel_x + x_side * panel_w * 0.33,
                         top[1], base_z + post_height / 2),
                        support_mat, bevel_width=0.6)
    return modules


def stacked_bearing_shells(collection, parent, name, floor_sizes, shell_mats,
                           *, base_z=0.0, band_mat=None, band_height=12.0,
                           bevel_width=4.0):
    """Create independently named, vertically connected residential floors.

    ``floor_sizes`` is a bottom-to-top sequence of ``(width, depth, height)``.
    ``shell_mats`` may be one material or a material sequence matching the
    storeys. Optional floor bands remain attached to the corresponding shell.
    The returned dictionaries expose stable facade anchors for later details.
    """
    sizes = [tuple(float(value) for value in size) for size in floor_sizes]
    if not sizes:
        raise ValueError("stacked_bearing_shells requires at least one floor")
    if isinstance(shell_mats, (list, tuple)):
        materials = list(shell_mats)
        if len(materials) != len(sizes):
            raise ValueError("shell_mats must match floor_sizes")
    else:
        materials = [shell_mats] * len(sizes)

    records = []
    current_z = float(base_z)
    for index, ((width, depth, height), shell_mat) in enumerate(
            zip(sizes, materials), start=1):
        prefix = f"{name}_Level{index}"
        box(collection, parent, prefix + "_BearingShell",
            (width, depth, height), (0, 0, current_z + height / 2),
            shell_mat, bevel_width=bevel_width if index == 1 else max(2.0, bevel_width - 1.0))
        if band_mat is not None and index > 1:
            box(collection, parent, prefix + "_FloorBandFront",
                (width + 14, 13, band_height),
                (0, -depth / 2 - 4, current_z), band_mat, bevel_width=1.5)
            box(collection, parent, prefix + "_FloorBandSide",
                (13, depth + 14, band_height),
                (-width / 2 - 4, 0, current_z), band_mat, bevel_width=1.5)
        records.append({
            "index": index,
            "base": current_z,
            "top": current_z + height,
            "width": width,
            "depth": depth,
            "height": height,
            "front_y": -depth / 2 - 4,
            "side_x": -width / 2 - 4,
        })
        current_z += height
    return records


def double_doors(collection, parent, name, location, width, height, timber, iron, open_angle=24):
    x, y, z = location
    leaf_w = width / 2 - 3
    for side in (-1, 1):
        leaf_x = x + side * (leaf_w / 2 + 3)
        door = box(collection, parent, f"{name}_Leaf_{side:+d}", (leaf_w, 8, height),
                   (leaf_x, y, z + height / 2), timber,
                   rotation=(0, 0, side * open_angle), bevel_width=2)
        for row in (-height * 0.28, 0, height * 0.28):
            box(collection, door, f"{name}_Band_{side:+d}_{int(row)}", (leaf_w - 8, 4, 5),
                (0, -6, row), iron, bevel_width=0.5)
        for hinge_z in (-height * 0.32, height * 0.32):
            box(collection, door, f"{name}_Hinge_{side:+d}_{int(hinge_z)}", (leaf_w * 0.72, 5, 4),
                (-side * leaf_w * 0.08, -7, hinge_z), iron, bevel_width=0.4)
        cylinder(collection, door, f"{name}_Ring_{side:+d}", 4.5, 3,
                 (-side * leaf_w * 0.25, -8, 0), iron, rotation=(90, 0, 0), vertices=24)


def chimney(collection, parent, name, location, stone, iron, height=112):
    x, y, z = location
    box(collection, parent, name + "_Shaft", (38, 38, height), (x, y, z + height / 2), stone, bevel_width=2.5)
    box(collection, parent, name + "_Band", (44, 44, 9), (x, y, z + height - 18), iron, bevel_width=1)
    box(collection, parent, name + "_Cap", (49, 49, 10), (x, y, z + height + 2), stone, bevel_width=2)
    box(collection, parent, name + "_Opening", (29, 29, 8), (x, y, z + height + 8), iron, bevel_width=1)


def gear(collection, parent, name, radius, location, metal, axis="Y", teeth=12):
    rotation = (90, 0, 0) if axis == "Y" else (0, 90, 0)
    cylinder(collection, parent, name + "_Disk", radius * 0.72, 7, location, metal,
             rotation=rotation, vertices=48, bevel_width=1)
    x, y, z = location
    for index in range(teeth):
        angle = 360 * index / teeth
        rad = math.radians(angle)
        if axis == "Y":
            tx, ty, tz = x + math.cos(rad) * radius, y - 5, z + math.sin(rad) * radius
            rot = (0, angle, 0)
            size = (radius * 0.30, 6, radius * 0.18)
        else:
            tx, ty, tz = x - 5, y + math.cos(rad) * radius, z + math.sin(rad) * radius
            rot = (angle, 0, 0)
            size = (6, radius * 0.30, radius * 0.18)
        box(collection, parent, f"{name}_Tooth_{index:02d}", size, (tx, ty, tz), metal,
            rotation=rot, bevel_width=0.5)
    cylinder(collection, parent, name + "_Hub", radius * 0.18, 10, location, metal,
             rotation=rotation, vertices=32, bevel_width=0.8)


def wind_rotor(collection, parent, name, hub_location, hub_back_mat,
               hub_front_mat, blade_mat, accent_mat, *, axis="Y",
               blade_count=4, start_angle=45, inner_radius=23,
               outer_radius=277, root_width=48, tip_width=48,
               thickness=9, style="lattice", lattice_slats=5):
    """Editable, animation-ready rotor shared by windmills and turbines.

    ``axis`` is the axle axis (X or Y).  The lattice style preserves the wheat
    windmill's four framed sails; turbine style creates broad tapered blade
    skins with separate reinforcing spines, suitable for power machinery.  All
    moving parts are parented to one hub-centered ``*_Pivot`` empty so callers
    can rotate the complete rotor on its local axle axis.
    """
    axis = str(axis).upper()
    if axis not in ("X", "Y"):
        raise ValueError(f"unsupported wind rotor axis: {axis}")
    blade_count = max(2, int(blade_count))
    inner_radius = float(inner_radius)
    outer_radius = max(inner_radius + 8, float(outer_radius))
    root_width = max(4, float(root_width))
    tip_width = max(4, float(tip_width))
    thickness = max(2, float(thickness))
    hx, hy, hz = (float(value) for value in hub_location)
    hub_rotation = (90, 0, 0) if axis == "Y" else (0, 90, 0)

    pivot = bpy.data.objects.new(name + "_Pivot", None)
    collection.objects.link(pivot)
    pivot.parent = parent
    pivot.location = (hx, hy, hz)
    pivot.rotation_mode = "XYZ"
    pivot.empty_display_type = "CIRCLE"
    pivot.empty_display_size = max(24.0, inner_radius * 0.72)
    pivot["rotation_axis"] = axis
    pivot["animation_ready"] = True

    def point(u, v, axial):
        if axis == "Y":
            return (u, axial, v)
        return (axial, u, v)

    cylinder(collection, pivot, name + "_Hub_Back", 29, 18,
             point(0, 0, 0), hub_back_mat, rotation=hub_rotation,
             vertices=48, bevel_width=1.2)
    cylinder(collection, pivot, name + "_Hub_Front", 23, 28,
             point(0, 0, -10), hub_front_mat, rotation=hub_rotation,
             vertices=48, bevel_width=1.2)

    blade_length = outer_radius - inner_radius
    blade_center = (outer_radius + inner_radius) * 0.5
    for blade_index in range(blade_count):
        angle = float(start_angle) + 360.0 * blade_index / blade_count
        rad = math.radians(angle)
        radial = (math.cos(rad), math.sin(rad))
        tangent = (-math.sin(rad), math.cos(rad))
        center_u = radial[0] * blade_center
        center_v = radial[1] * blade_center
        rotation = (0, -angle, 0) if axis == "Y" else (angle, 0, 0)

        if style == "lattice":
            if axis == "Y":
                spine_size = (blade_length, thickness, 10)
                rail_size = (blade_length - 4, max(4, thickness - 2), 7)
                slat_size = (7, max(4, thickness - 2), root_width)
            else:
                spine_size = (thickness, blade_length, 10)
                rail_size = (max(4, thickness - 2), blade_length - 4, 7)
                slat_size = (max(4, thickness - 2), 7, root_width)
            box(collection, pivot, f"{name}_Blade_{blade_index}_CenterSpine",
                spine_size, point(center_u, center_v, -23), blade_mat,
                rotation=rotation, bevel_width=1)
            for rail_index, offset in enumerate((-root_width / 2, root_width / 2)):
                rail_u = center_u + tangent[0] * offset
                rail_v = center_v + tangent[1] * offset
                box(collection, pivot,
                    f"{name}_Blade_{blade_index}_Rail_{rail_index}",
                    rail_size, point(rail_u, rail_v, -24), blade_mat,
                    rotation=rotation, bevel_width=0.8)
            slat_count = max(2, int(lattice_slats))
            for slat_index in range(slat_count):
                t = 0.5 if slat_count == 1 else slat_index / (slat_count - 1)
                longitudinal = (t - 0.5) * blade_length * 0.76
                slat_u = center_u + radial[0] * longitudinal
                slat_v = center_v + radial[1] * longitudinal
                box(collection, pivot,
                    f"{name}_Blade_{blade_index}_Slat_{slat_index}",
                    slat_size, point(slat_u, slat_v, -25), blade_mat,
                    rotation=rotation, bevel_width=0.6)
            continue

        if style != "turbine":
            raise ValueError(f"unsupported wind rotor style: {style}")

        root_left = (radial[0] * inner_radius - tangent[0] * root_width / 2,
                     radial[1] * inner_radius - tangent[1] * root_width / 2)
        root_right = (radial[0] * inner_radius + tangent[0] * root_width / 2,
                      radial[1] * inner_radius + tangent[1] * root_width / 2)
        tip_left = (radial[0] * outer_radius - tangent[0] * tip_width / 2,
                    radial[1] * outer_radius - tangent[1] * tip_width / 2)
        tip_right = (radial[0] * outer_radius + tangent[0] * tip_width / 2,
                     radial[1] * outer_radius + tangent[1] * tip_width / 2)
        axial_back = -23 + thickness / 2
        axial_front = -23 - thickness / 2
        outline = (root_left, tip_left, tip_right, root_right)
        vertices = [point(u, v, axial_back) for u, v in outline]
        vertices.extend(point(u, v, axial_front) for u, v in outline)
        faces = [
            (0, 1, 2, 3), (7, 6, 5, 4),
            (0, 4, 5, 1), (1, 5, 6, 2),
            (2, 6, 7, 3), (3, 7, 4, 0),
        ]
        mesh = bpy.data.meshes.new(f"{name}_Blade_{blade_index}_Mesh")
        mesh.from_pydata(vertices, [], faces)
        mesh.materials.append(blade_mat)
        blade = bpy.data.objects.new(f"{name}_Blade_{blade_index}_Skin", mesh)
        collection.objects.link(blade)
        blade.parent = pivot
        bevel(blade, 1.2, 2)
        if axis == "Y":
            spine_size = (blade_length - 12, thickness + 3, 8)
        else:
            spine_size = (thickness + 3, blade_length - 12, 8)
        box(collection, pivot, f"{name}_Blade_{blade_index}_Spine",
            spine_size, point(center_u, center_v, -28), accent_mat,
            rotation=rotation, bevel_width=0.8)

    cylinder(collection, pivot, name + "_Hub_Cap", 13, 34,
             point(0, 0, -27), accent_mat, rotation=hub_rotation,
             vertices=32, bevel_width=1)
    return pivot


def lantern(collection, parent, name, location, iron, glow, orientation="front"):
    x, y, z = location
    if orientation == "front":
        box(collection, parent, name + "_Bracket", (27, 5, 5), (x, y + 10, z + 23), iron, bevel_width=0.5)
    else:
        box(collection, parent, name + "_Bracket", (5, 27, 5), (x + 10, y, z + 23), iron, bevel_width=0.5)
    box(collection, parent, name + "_Cage", (20, 20, 34), (x, y, z), iron, bevel_width=2)
    box(collection, parent, name + "_Glow", (13, 13, 25), (x, y, z), glow, bevel_width=1)
    cylinder(collection, parent, name + "_Top", 14, 6, (x, y, z + 21), iron, vertices=8)
    cylinder(collection, parent, name + "_Bottom", 12, 5, (x, y, z - 20), iron, vertices=8)


def workbench(collection, parent, name, location, timber, iron):
    x, y, z = location
    box(collection, parent, name + "_Top", (96, 42, 11), (x, y, z + 48), timber, bevel_width=2)
    for side in (-1, 1):
        box(collection, parent, f"{name}_Leg_{side:+d}_F", (9, 9, 48), (x + side * 36, y - 13, z + 24), timber)
        box(collection, parent, f"{name}_Leg_{side:+d}_B", (9, 9, 48), (x + side * 36, y + 13, z + 24), timber)
    box(collection, parent, name + "_ViceBase", (25, 18, 9), (x - 26, y - 5, z + 58), iron, bevel_width=1.5)
    box(collection, parent, name + "_ViceJaw", (7, 23, 19), (x - 33, y - 5, z + 66), iron, bevel_width=1)


def anvil(collection, parent, name, location, iron):
    x, y, z = location
    box(collection, parent, name + "_Foot", (34, 26, 9), (x, y, z + 5), iron, bevel_width=2)
    box(collection, parent, name + "_Waist", (19, 17, 27), (x, y, z + 22), iron, bevel_width=3)
    box(collection, parent, name + "_Face", (51, 23, 10), (x, y, z + 40), iron, bevel_width=2)
    box(collection, parent, name + "_Horn", (25, 15, 9), (x + 32, y, z + 40), iron,
        rotation=(0, -8, 0), bevel_width=3)


def cat_mount_nest(collection, parent, name, location, size, wall_mat,
                   roof_mat, interior_mat, accent_mat, *, roof_style="gable"):
    """Open-front resting bay sized for a rideable cat, with cat-ear identity."""
    x, y, z = (float(value) for value in location)
    width, depth, height = (float(value) for value in size)
    wall = max(8.0, min(width, depth) * 0.10)
    rear_y = y + depth / 2 - wall / 2

    box(collection, parent, name + "_RearWall", (width, wall, height),
        (x, rear_y, z + height / 2), wall_mat, bevel_width=3)
    for side, label in ((-1, "Left"), (1, "Right")):
        side_x = x + side * (width / 2 - wall / 2)
        box(collection, parent, f"{name}_{label}Wall",
            (wall, depth, height), (side_x, y, z + height / 2),
            wall_mat, bevel_width=3)

    roof_base = z + height - 2
    if roof_style == "flat":
        box(collection, parent, name + "_FlatCanopy",
            (width + 14, depth + 14, 12),
            (x, y, roof_base + 6), roof_mat, bevel_width=4)
        fascia_z = roof_base + 4
    elif roof_style == "gable":
        gabled_prism(collection, parent, name + "_GabledCanopy",
                     width + 16, depth + 18, max(28.0, height * 0.34),
                     (x, y, roof_base), wall_mat, roof_mat)
        fascia_z = roof_base + max(24.0, height * 0.24)
    elif roof_style == "shared":
        # The bay sits under its parent building's one continuous roof.  Keep
        # only an open-front header so the nest does not create a second roof.
        box(collection, parent, name + "_SharedRoofHeader",
            (width, 12, 15),
            (x, y - depth / 2 + 6, roof_base - 6),
            wall_mat, bevel_width=2)
        fascia_z = roof_base - 3
    else:
        raise ValueError(f"unsupported cat-mount nest roof style: {roof_style}")

    box(collection, parent, name + "_RestingPad",
        (width - wall * 2.4, depth * 0.58, 10),
        (x, y + depth * 0.12, z + 5), interior_mat, bevel_width=5)

    # Two triangular prisms read as cat ears from the fixed front isometric view.
    for side, label in ((-1, "Left"), (1, "Right")):
        cylinder(collection, parent, f"{name}_CatEar_{label}",
                 max(9.0, width * 0.10), 8,
                 (x + side * width * 0.22, y - depth / 2 - 10, fascia_z),
                 accent_mat, rotation=(90, 0, 0), vertices=3,
                 bevel_width=1)
    return {
        "frontY": y - depth / 2,
        "roofZ": roof_base,
        "width": width,
        "depth": depth,
    }


def post_and_rail_enclosure(collection, parent, name, width, front_y, back_y,
                            base_z, timber, *, gate_width=0,
                            rail_offsets=(30, 66), post_height=82,
                            post_spacing=120, include_back=True,
                            gate_leaves=False, gate_open_angle=58):
    """Editable wooden perimeter fence with an optional centered front gate."""
    half_width = float(width) / 2
    front_y, back_y = sorted((float(front_y), float(back_y)))
    depth = back_y - front_y
    rail_size = 8.0
    post_size = 11.0

    for side, label in ((-1, "Left"), (1, "Right")):
        x = side * half_width
        for index, offset in enumerate(rail_offsets):
            box(collection, parent, f"{name}_{label}Rail_{index}",
                (rail_size, depth, rail_size),
                (x, (front_y + back_y) / 2, base_z + offset), timber,
                bevel_width=1)
        segments = max(1, int(math.ceil(depth / max(1.0, post_spacing))))
        for index in range(segments + 1):
            y = front_y + depth * index / segments
            box(collection, parent, f"{name}_{label}Post_{index:02d}",
                (post_size, post_size, post_height),
                (x, y, base_z + post_height / 2), timber,
                bevel_width=1.5)

    if include_back:
        for index, offset in enumerate(rail_offsets):
            box(collection, parent, f"{name}_BackRail_{index}",
                (width, rail_size, rail_size),
                (0, back_y, base_z + offset), timber, bevel_width=1)
        segments = max(1, int(math.ceil(width / max(1.0, post_spacing))))
        for index in range(1, segments):
            x = -half_width + width * index / segments
            box(collection, parent, f"{name}_BackPost_{index:02d}",
                (post_size, post_size, post_height),
                (x, back_y, base_z + post_height / 2), timber,
                bevel_width=1.5)

    gate_width = max(0.0, min(float(gate_width), width - post_size * 4))
    front_segments = ((-half_width, -gate_width / 2),
                      (gate_width / 2, half_width)) if gate_width else ((-half_width, half_width),)
    for segment_index, (start_x, end_x) in enumerate(front_segments):
        length = end_x - start_x
        center_x = (start_x + end_x) / 2
        for rail_index, offset in enumerate(rail_offsets):
            box(collection, parent,
                f"{name}_FrontRail_{segment_index}_{rail_index}",
                (length, rail_size, rail_size),
                (center_x, front_y, base_z + offset), timber,
                bevel_width=1)
        segments = max(1, int(math.ceil(length / max(1.0, post_spacing))))
        for index in range(1, segments):
            x = start_x + length * index / segments
            box(collection, parent,
                f"{name}_FrontPost_{segment_index}_{index:02d}",
                (post_size, post_size, post_height),
                (x, front_y, base_z + post_height / 2), timber,
                bevel_width=1.5)

    if gate_width:
        for side, label in ((-1, "Left"), (1, "Right")):
            hinge_x = side * gate_width / 2
            box(collection, parent, f"{name}_GatePost_{label}",
                (post_size + 4, post_size + 4, post_height + 16),
                (hinge_x, front_y, base_z + (post_height + 16) / 2), timber,
                bevel_width=2)
            if not gate_leaves:
                continue
            gate_parent = bpy.data.objects.new(f"{name}_GateLeaf_{label}_Hinge", None)
            collection.objects.link(gate_parent)
            gate_parent.parent = parent
            gate_parent.location = (hinge_x, front_y, base_z)
            gate_parent.rotation_euler.z = math.radians(side * gate_open_angle)
            leaf_length = gate_width / 2 - 7
            local_center_x = -side * leaf_length / 2
            for rail_index, offset in enumerate(rail_offsets):
                box(collection, gate_parent,
                    f"{name}_GateLeaf_{label}_Rail_{rail_index}",
                    (leaf_length, rail_size + 2, rail_size + 2),
                    (local_center_x, 0, offset), timber, bevel_width=1)
            box(collection, gate_parent, f"{name}_GateLeaf_{label}_Brace",
                (leaf_length * 0.88, rail_size, rail_size),
                (local_center_x, 0, sum(rail_offsets) / len(rail_offsets)), timber,
                rotation=(0, -28 * side, 0), bevel_width=1)


def setup_scene(spec, preview_path):
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    resolution = int(spec["camera"]["resolution"])
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = True
    scene.render.filepath = preview_path
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.25

    world = bpy.data.worlds.new("World122_Neutral_World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.18, 0.19, 0.21, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.78
    scene.world = world

    sun_data = bpy.data.lights.new("Key_Sun", "SUN")
    sun_data.energy = 1.8
    sun_data.angle = math.radians(20)
    sun = bpy.data.objects.new("Key_Sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(42), 0, math.radians(-38))

    fill_data = bpy.data.lights.new("Soft_Fill", "AREA")
    fill_data.energy = 680
    fill_data.shape = "DISK"
    fill_data.size = 650
    fill = bpy.data.objects.new("Soft_Fill", fill_data)
    scene.collection.objects.link(fill)
    fill.location = (-480, -620, 720)
    fill.rotation_euler = (mathutils.Vector((0, 0, 150)) - fill.location).to_track_quat("-Z", "Y").to_euler()


def setup_camera(spec, root):
    cfg = spec["camera"]
    elevation = math.radians(float(cfg["elevation"]))
    azimuth = math.radians(float(cfg.get("azimuth", 0)))
    data = bpy.data.cameras.new("World122_Ortho_Camera_30deg")
    data.type = "ORTHO"
    data.clip_start = 0.1
    data.clip_end = 5000
    camera = bpy.data.objects.new("World122_Ortho_Camera_30deg", data)
    bpy.context.scene.collection.objects.link(camera)
    distance = 1800
    camera.location = (distance * math.cos(elevation) * math.sin(azimuth),
                       -distance * math.cos(elevation) * math.cos(azimuth),
                       distance * math.sin(elevation))
    camera.rotation_euler = (math.radians(90) - elevation, 0, azimuth)
    bpy.context.view_layer.update()

    corners = []
    for obj in root.children_recursive:
        if obj.type == "MESH":
            corners.extend(obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box)
    inverse = camera.matrix_world.inverted()
    points = [inverse @ corner for corner in corners]
    min_x, max_x = min(p.x for p in points), max(p.x for p in points)
    min_y, max_y = min(p.y for p in points), max(p.y for p in points)
    resolution = int(cfg["resolution"])
    width_margin = float(cfg.get("widthMargin", 0.88))
    top_margin = float(cfg.get("topMargin", 50)) / resolution
    bottom_y = float(cfg.get("bottomY", 910)) / resolution
    scale = max((max_x - min_x) / width_margin,
                (max_y - min_y) / max(0.1, bottom_y - top_margin)) * 1.025
    data.ortho_scale = scale
    data.shift_x = ((min_x + max_x) / 2) / scale
    target_bottom = (0.5 - bottom_y) * scale
    data.shift_y = (min_y - target_bottom) / scale
    return camera


def render_depth(scene, root, camera, depth_path, label="Building"):
    corners = []
    for obj in root.children_recursive:
        if obj.type == "MESH" and not obj.hide_render:
            corners.extend(obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box)
    inverse = camera.matrix_world.inverted()
    depths = [-(inverse @ corner).z for corner in corners]
    zmin, zmax = min(depths), max(depths)
    span = max(zmax - zmin, 1e-6)
    zmin -= span * 0.01
    zmax += span * 0.01
    bpy.context.view_layer.use_pass_z = True
    group = bpy.data.node_groups.new(label + "_Depth_Compositor", "CompositorNodeTree")
    scene.compositing_node_group = group
    nodes, links = group.nodes, group.links
    layers = nodes.new("CompositorNodeRLayers")
    mapper = nodes.new("ShaderNodeMapRange")
    mapper.clamp = True
    mapper.inputs["From Min"].default_value = zmin
    mapper.inputs["From Max"].default_value = zmax
    mapper.inputs["To Min"].default_value = 1.0
    mapper.inputs["To Max"].default_value = 0.0
    multiply = nodes.new("ShaderNodeMath")
    multiply.operation = "MULTIPLY"
    output = nodes.new("NodeGroupOutput")
    group.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    links.new(layers.outputs["Depth"], mapper.inputs["Value"])
    links.new(mapper.outputs["Result"], multiply.inputs[0])
    links.new(layers.outputs["Alpha"], multiply.inputs[1])
    links.new(multiply.outputs[0], output.inputs["Image"])
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "BW"
    scene.render.image_settings.color_depth = "8"
    scene.render.dither_intensity = 0
    scene.view_settings.view_transform = "Raw"
    try:
        scene.view_settings.look = "None"
    except TypeError:
        pass
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    scene.render.filepath = depth_path
    bpy.ops.render.render(write_still=True)
