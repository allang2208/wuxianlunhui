# Hamster boiler worker accepted mother references

The accepted design uses these project mothers as direct style references:

- `../_hamster_residents_20260825/mothers/resident-03-transparent.png`
- `../_hamster_residents_20260825/mothers/resident-04-transparent.png`

The worker keeps only the role-readable elements: a soft dark worker cap,
matte charcoal jacket and overalls, off-white rolled sleeves, a muted rust-red sash,
simple gloves, and a small coal smudge. It matches the resident set's natural hamster
face, restrained eye size, compact proportions, exposed feet, aged cloth rendering,
three-quarter-right view, and footline. Goggles, armor, tools, boots, and steampunk
hardware are explicitly excluded.

The built-in ImageGen source outputs were copied into the task archive, after which
the redundant default generated-image copies were removed:

- Empty white source: `exec-7bd43bb8-b8e3-49a0-b1ad-8fee73147d69.png`
- Food white source: `exec-f293e708-d83b-4002-80d6-a10990801fd1.png`
- Energy white source: `exec-78c36888-8561-49c8-aa12-6c0e9297e150.png`

The white sources are stored as `mothers/hamster-boiler-worker-v2*-white-raw.png`.
`prepare-v2-references.py` loads the project's ComfyUI-RMBG BiRefNet-general model
once, reconstructs true RGBA mothers with white-matte decontamination, and produces
the normalized 1024x1024 white video references at a common 760 px body height and
foot line. The v2 preview is `previews/hamster-boiler-worker-v2-reference-contact.jpg`.

All runtime frames are rebuilt from the four accepted Doubao videos. The mother
images are provenance and first-frame references only.
