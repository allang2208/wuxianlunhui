# Defense tower cold-steel icon family

- Generator: Codex built-in `image_gen`
- Style authority: `assets/ui/building-upgrades/attack-damage.png`
- Runtime contract: 209×209 RGBA formal icon, 128×128 RGBA lightweight mirror
- Display size: six-dimension chips 46×46; upgrade modules 52×52

## Shared prompt contract

Use the same four-rivet clipped-corner gunmetal square badge, dark navy-black
circular inset, silver beveled relief and restrained icy-cyan backlight as the
existing World-122 building-upgrade family. Keep the complete frame and real
transparent corners. The central subject is a compact tactical glyph, not a
full device or standalone product render. No text, numbers, logo, watermark,
concrete, hazard stripes, yellow paint or decorative rarity colours.

All icons after `tower-chip-strength` used that accepted strength render as the
exact frame/style reference. `finalize_icons.py` keeps the strength frame as the
single master and replaces only the central circular artwork, preventing frame
drift and removing generated checker/black canvases deterministically.

## Subjects

| Key | Central symbol |
| --- | --- |
| `tower-chip-strength` | Reinforced hydraulic piston through a steel gear collar |
| `tower-chip-dexterity` | Precision servo gimbal with targeting needle and motion arcs |
| `tower-chip-constitution` | Three nested armor plates around a solid core |
| `tower-chip-intelligence` | Tactical processor with symmetric circuit traces |
| `tower-chip-spirit` | Signal core with concentric resonance rings |
| `tower-chip-luck` | Four-point tactical star in a broken probability ring |
| `tower-module-damage` | Armor-piercing projectile striking layered plate |
| `tower-module-range` | Long-range reticle with projectile needle and distance brackets |
| `tower-module-attspd` | Rotary firing gear with cartridges and speed strokes |
| `tower-module-reload` | Magazine entering a receiver inside a reload arrow |
| `tower-module-overheat` | Barrel core inside a segmented thermal shield |
| `tower-module-cooling` | Radial cooling turbine, radiator fins and airflow curves |
