# Energy rubble surrounding props

Three tiny peripheral prop families were generated with the accepted V03 energy-rubble image as style, camera and lighting authority: three-stone mineral chip, loose gravel crescent and neutral chipped-rock scatter. Blue sources are locally transformed into the same dark-rock pure-purple cavern palette used by the high-energy nodes.

`export-surroundings.py` keys the green background, normalizes the small props and composes two 64-frame ground-layer atlases. Frame mapping is `visualVariant * 16 + fourNeighborMask`; props appear only toward missing four-neighbor directions. The atlas is attached to the existing mineral ground-contact layer, so no decoration entity, collision, footprint, pathfinding entry, save field or per-frame drawing is added.

Each frame is composed at 384×216, then downsampled to its 192×108 runtime and display size before atlas packing. This covers roughly one neighboring ground-cell ring while keeping both resident atlases at 1536×864. Fixed lighting prohibits rotation and mirroring; four deterministic compositions provide variation.
