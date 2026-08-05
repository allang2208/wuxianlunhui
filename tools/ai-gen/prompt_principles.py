#!/usr/bin/env python3
"""Single source of truth for generation style principles.

All non-UI / non-icon game-asset generations follow:
  - no light source, no shadows (drop/cast shadow, studio/directional/rim light
    are forbidden in positive prompts; they only belong in negative prompts)
  - solid background in a color the subject does not contain (see
    pick_bg_color.py / comfyui-gen.py --transparent)

UI/icon templates (skill-icon.md, equipment-icon.md) are exempt.
"""

STYLE_BASELINE = (
    "game asset prop, photorealistic 3D render, dark realistic materials, "
    "flat diffuse ambient lighting, no light source, no shadows, no drop shadow, "
    "centered composition, isolated on plain pure white background, high detail, "
    "no text, no watermark"
)

# Terms that are FORBIDDEN in positive prompts / templates. They are expected
# (and required) in negative prompts.
BAD_LIGHT_TERMS = [
    "studio lighting",
    "dramatic lighting",
    "rim light",
    "drop shadow",
    "cast shadow",
    "directional light",
]
