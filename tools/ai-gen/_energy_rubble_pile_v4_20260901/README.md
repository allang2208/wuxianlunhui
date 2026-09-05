# Energy rubble pile V4

This task replaces the five internal-only mineral layouts with five genuinely different low 1×1 rubble silhouettes while preserving gameplay occupancy, camera, light direction, harvesting and save behavior.

The completed shape family is compact plateau, twin saddle, flattened diagonal ridge, front scatter and crescent notch. Each model consists only of individual overlapping rock volumes; no slab, plane or foundation is present. The selected V3 low-pile art remains the style authority.

The five blue sources were produced with built-in ImageGen using the accepted V3 image for style and the five Blender previews for structure. A requested FLUX.2 Dev upload to the LAN ComfyUI endpoint was not run because the standing upload authorization is scoped to mining-guild building assets. Its unused candidate manifest was removed during final cleanup; the rejection reason remains here and in `cleanup-manifest.json`, and the unexecuted plan is not presented as provenance for the installed files.

`export-runtime.py` applies the shared chroma-key/finalize/depletion tools, normalizes every body to a 256×144 canvas with one bottom line, derives the dark-rock pure-purple cavern family and creates 16 four-neighbor contact layers. The later `surroundings/` pass adds three tiny peripheral prop families and composes them into blue/purple 64-frame ground-layer atlases, without adding decoration entities. Runtime records and comparison boards are under `runtime/` and `surroundings/`.

The runtime pass also adds save-stable 96%–104% scale/offset variation and prevents a newly generated node from reusing the same silhouette as an already assigned four-neighbor. No random rotation or mirror is allowed because the lighting is fixed. No runtime test, browser, build or game launch was performed under the project agreement.
