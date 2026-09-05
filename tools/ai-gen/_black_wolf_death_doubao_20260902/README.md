# Black wolf death delivery

This task adds the missing one-way death action for the existing `blackWolf` enemy.

- Provider: Doubao desktop, Seedance 2.0 Mini, one candidate.
- Source: `videos/black-wolf-dying-doubao-v01.mp4` plus provenance sidecar.
- Whole-source preview: `previews/black-wolf-dying-doubao-v01.gif`.
- Formal preview: `previews/sprites/formal-final/death/black-wolf-death.gif`.
- Formal window: inclusive source frames 0..64 at 24 fps; settled corpse begins at f56.
- Processing: BiRefNet cutout, fixed scale/source coordinates, one RIFE pass, 33 final frames.
- Runtime atlas: `assets/enemies/black_wolf_dying.png`, 448x288 cells, 5x7, `endFrame=32`.
- Runtime: 2667 ms death plus 1000 ms corpse hold; manual frame clock and preserved-corpse cleanup.

No game, browser, build, or runtime validation is part of this delivery.
