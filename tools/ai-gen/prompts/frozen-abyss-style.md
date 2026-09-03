# Frozen Abyss Autotile Style Contract

Use `world122-building-style.md` exactly once as the shared visual contract. This file adds only frozen-abyss identity and terrain-specific constraints; it does not replace or repeat the public style block.

## Identity and structure

- A natural collapsed ice shelf cut into compacted dungeon snow, presented as a 128x64 isometric terrain autotile.
- Preserve the authored Blender Depth, exact 30-degree orthographic camera, 44.8-degree model-root rotation, cliff thickness and the selected `+u/+v/-u/-v` neighbor topology.
- The outer silhouette reads as a compressed snow overhang above a stratified blue-ice fracture. The abyss interior is broad, dark and visually quiet.
- This is terrain, not a building: no foundation slab, masonry blocks, brick courses, battlements, crenellations, fence rails, manufactured trim or architectural ornament.

## Material direction

- Clean semi-realistic strategy-game PBR consistent with accepted World-122 buildings.
- Large calm material fields dominate: one compacted snow mass, one blue-gray ice break and one deep void field.
- Snow is dense and slightly wind-packed, not fluffy foam. Ice has restrained translucency cues, broad strata and sparse medium-scale fractures rather than glassy neon crystal.
- Keep colors low-saturation and neutral: off-white snow, blue-gray ice and a near-black navy abyss. Avoid cyan glow, bright turquoise edges, saturated fantasy blue and bloom.
- Wear and fracture remain sparse and structurally meaningful. No dense granular noise, repeated square teeth, evenly spaced spikes, micro-scratches or uniform edge chipping.

## Seam and runtime constraints

- Author one quiet abyss interior master and four fixed-light directional edge masters. Build the 16 neighbor-mask frames deterministically from those shared masters; do not ask the image model to invent 16 independent versions.
- Connected abyss edges contain no snow lip or cliff face. Exposed edges contain the complete rim and cliff section.
- Every tile edge terminates at the same neutral cross-section so adjacent frames join without a visible step, gap, double cap or lighting discontinuity.
- Do not bevel or brighten internal void-cell borders. Preserve slight dark overdraw so connected cells read as one continuous abyss.
- Do not rotate, mirror, stretch or relight individual frames. Lighting direction is baked once for all 16 masks.
- Produce no cast shadow outside the authored snow/ice body. Contact occlusion is allowed only where snow rests on ice and fracture chunks touch the rim.

## Readability target

At gameplay scale, the player should first read walkable snow versus lethal void, then the ice-shelf thickness, and only then sparse fracture detail. The result must remain believable and understated beside current medieval, industrial and future World-122 buildings.
