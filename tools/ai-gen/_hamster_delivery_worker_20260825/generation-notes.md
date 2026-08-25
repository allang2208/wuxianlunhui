# Chain restaurant delivery worker candidate

Mode: built-in ImageGen identity/idle pass followed by reference-guided Doubao
Seedance running passes. The accepted sheets are registered in runtime.

Identity prompt summary: one original anthropomorphic hamster civilian worker in
the established World-122 painterly low-saturation style, wearing a clearly
readable mustard-yellow delivery jacket, matching cap and apron, brown trousers,
dark shoes, and a small leather satchel; friendly face, empty hands, full body,
three-quarter right view.

Idle sheet prompt summary: preserve the identity and outfit exactly; six distinct
idle frames in an exact 3x2 grid, subtle breathing, blinking and ear movement,
feet planted, empty hands, no locomotion.

Empty-running sheet prompt summary: preserve the identity and outfit exactly;
six distinct right-facing run poses in an exact 3x2 grid, empty hands, readable
alternating leg phases, no food or crate.

Loaded-running sheet prompt summary: preserve the identity and outfit exactly;
six distinct right-facing run poses in an exact 3x2 grid while holding exactly
two stacked wooden meal crates with simple utensil emblems, no readable text.

ImageGen returned RGB images with a baked checkerboard. The candidate sheets are
therefore rebuilt per cell with the project's cached BiRefNet-general model and
written as genuine RGBA assets. All actions share one fixed scale derived from
the median idle height; each frame is centered and grounded to the same footline.

## Doubao replacement pass

The user accepted only the idle design and rejected the two ImageGen running
grids as final animation. Empty and loaded running were therefore regenerated as
separate 5-second, 1:1 Doubao Seedance 2.0 Mini videos after mandatory
`fill-only` prompt verification. Empty V1 was rejected for frontal rotation;
empty V2 used a right-facing running keyframe. Loaded V1 kept both crates stable.
The accepted source windows, tail cleanup and RIFE output contracts are recorded
in `STATUS.md`, `video-sheets/base-report.json`, and the three reports under
`video-sheets/final/`.

The compact archive intentionally keeps the approved idle grid plus the two
rejected running grids because their first cells are the identity/action
keyframes consumed by `prepare-video-references.py`. Replaced raw generations,
obsolete preview sets, diagnostic contacts, and the rejected frontal V1 video
were removed after the final sheets and provenance were retained.
