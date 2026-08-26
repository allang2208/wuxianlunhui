# STG-44 / QBZ modification icon ImageGen prompts

Date: 2026-08-26

Mode: built-in `image_gen` edit, one invocation per asset. Each invocation used one existing `assets/icons/craft-cold-steel/*.png` image strictly as the style/layout reference.

## Shared exact wrapper

```text
Edit the provided game modification icon while preserving the same square dark navy gunmetal frame, four corner bolts, circular recessed inner panel, realistic high-detail painted {MATERIAL} style, lighting, camera, and composition. Replace the center contents with {SUBJECT}. Center the single {OBJECT} with generous margin inside the circular panel. Asset type: RPG weapon modification inventory icon.
```

## Per-asset substitutions and references

| Output | Reference | MATERIAL | OBJECT | SUBJECT |
| --- | --- | --- | --- | --- |
| `stamped_receiver_tuning.png` | `piston_tuning.png` | metal | part | exactly one standalone STG-44 stamped sheet-metal receiver housing: long rectangular blackened-steel rifle receiver shell with ribbed pressed reinforcement lines and one ejection-port opening, no barrel, no stock, no pistol grip, no magazine, no complete gun, no detached pieces, no text, no symbols |
| `walnut_fixed_stock.png` | `wood_furniture.png` | material | stock | exactly one standalone STG-44 fixed buttstock made of rich dark walnut wood, recognizable angular WWII rifle butt profile with one small black steel buttplate, no receiver, no handguard, no pistol grip, no complete gun, no second wooden part, no detached pieces, no text, no symbols |
| `kurz_792_heavy.png` | `heavy_762.png` | metal | cartridge diagonally | exactly one standalone 7.92x33mm Kurz heavy rifle cartridge, a short bottleneck brass case with one dark copper pointed projectile, historically plausible compact intermediate-cartridge proportions, no cartridge box, no magazine, no gun, no second cartridge, no detached pieces, no text, no symbols |
| `qbz191_freefloat_handguard.png` | `long_barrel.png` | metal | handguard diagonally | exactly one standalone modern black free-floating rifle handguard, short angular aluminum tube with rows of elongated M-LOK slots and a short top Picatinny rail, no barrel, no receiver, no stock, no complete gun, no second object, no detached pieces, no text, no symbols |
| `qbz191_high_speed_trigger.png` | `light_trigger.png` | metal | module | exactly one standalone compact ambidextrous rifle fire-control trigger module: one curved black trigger lever attached to a small rectangular selector housing with a single round selector dial, clearly a gun mechanism and not a blade, no receiver, no pistol grip, no gun, no second part, no detached pieces, no text, no symbols |
| `dbp191_high_velocity.png` | `ap_ammo.png` | metal | cartridge diagonally | exactly one standalone Chinese 5.8x42mm DBP191 high-velocity rifle cartridge, slender pointed dark copper projectile seated in a green-lacquered steel bottleneck case, modern military proportions, no cartridge box, no magazine, no gun, no second cartridge, no detached pieces, no text, no symbols |
| `qbz95_gas_tuning.png` | `piston_tuning.png` | metal | assembly diagonally | exactly one standalone compact QBZ-95 short-stroke gas piston assembly: blackened steel piston rod, cylindrical regulator collar with small adjustment notches, and a compact piston head as one connected mechanism, no barrel, no receiver, no gun, no second object, no detached pieces, no text, no symbols |
| `qbz95_grip_insert.png` | `heavy_grip.png` | material | insert | exactly one standalone QBZ-95 bullpup grip insert: compact curved black textured polymer ergonomic insert shaped to fit inside a thumbhole-style pistol grip, with shallow finger grooves and two small mounting holes, no whole grip, no receiver, no gun, no second object, no detached pieces, no text, no symbols |
| `qbz95_rubber_buttpad.png` | `solid_core_stock.png` | material | buttpad | exactly one standalone QBZ-95 bullpup recoil-buffer rubber buttpad: thick compact black ribbed rubber pad, gently curved rectangular-trapezoid profile, one integrated dark metal mounting plate visible at the back, no stock, no receiver, no gun, no second object, no detached pieces, no text, no symbols |
| `dbp87_balanced_round.png` | `sniper_ammo.png` | metal | cartridge diagonally | exactly one standalone Chinese 5.8x42mm DBP87 balanced rifle cartridge, pointed copper-jacket projectile seated in a darker olive-green lacquered steel bottleneck case, sturdy military proportions distinct from the slimmer DBP191, no cartridge box, no magazine, no gun, no second cartridge, no detached pieces, no text, no symbols |

## Finalization

The built-in outputs were downscaled with high-quality bicubic resampling to the existing 209×209 `craft-cold-steel` icon contract by `finalize-rifle-mod-icons.ps1`. The original generated files remain in Codex's generated-image folder.
