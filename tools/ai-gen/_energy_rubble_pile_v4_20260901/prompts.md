# Image generation record

All five installed blue source images were generated on 2026-09-01 with OpenAI built-in ImageGen. Every request supplied two local references:

1. `tools/ai-gen/_energy_rubble_pile_20260831/candidates_dev_s12_low/energy_rubble_pile/energy_rubble_pile_structure_v03_raw.png` as the material, camera, lighting and style authority.
2. The corresponding `variant_*/model_preview.png` as the structure authority.

The common request fixed a 30-degree top-down isometric orthographic view, upper-left light, stylized broad faceted gray stone, small cyan-blue mineral pockets, pure green background, no slab, foundation, terrain tile, pedestal, text, UI or external cast shadow. Minerals had to form 3–5 uneven pockets rather than a line.

Variant structure requests:

- 1: low broad compact plateau with an irregular perimeter and no dominant peak.
- 2: two readable low lobes divided by a shallow central saddle.
- 3: narrow diagonal rubble ridge. The first result was rejected for a tall central spine; the installed redraw explicitly forbids a tall central stone, upright spine or monolith.
- 4: asymmetric front scatter with a compact rear core and separated low stones along the near edge.
- 5: crescent-shaped arc with a visible shallow open bite on one side.

Installed raw files are `raw/energy_rubble_v4_1_raw.png` through `raw/energy_rubble_v4_5_raw.png`. The uninstalled rejected first draw of variant 3 remains only in the ImageGen service cache and is not part of this task source chain.
