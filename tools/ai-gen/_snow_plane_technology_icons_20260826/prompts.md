# Snow-plane technology icon prompts

Generated with the built-in ImageGen path. The three existing plane technology badges
`jungle_temple_rites.png`, `desert_mansion_charter.png`, and `dungeon_explorer_corps.png`
were style references only.

- `snow_castle_architecture`: snow-covered Japanese-inspired academy fortress with a central
  tower, fortified gate, construction hammer, and drafting compass. Cold-steel pointed
  hexagonal badge, faceted charcoal inset, restrained icy-cyan glow, no text.
- `snow_ninjutsu`: black-wrapped hamster ninja bust with clearly visible golden-yellow fur
  around the eyes, a sheathed katana, and smoke-bomb curls. Same technology badge template,
  no text.

Both raw generations used a baked checkerboard. `finalize_icons.py` applies the project's
deterministic hexagonal alpha mask, normalizes the visible frame to 1000px, and writes the
1024x1024 RGBA runtime assets.
