# Poison Maggot Mother v01

- Status: candidate mother frame; not yet approved and not integrated into runtime assets.
- Generator: built-in ImageGen.
- Identity reference: `tools/verify-shots/maggot_idle_frame0.png`.
- Raw generated source: `poison-maggot-mother-v01-raw-checker.png`.
- Final transparent candidate: `poison-maggot-mother-v01.png`.
- Alpha source: `poison-maggot-mother-v01-birefnet-mask.png`.
- Processing: BiRefNet silhouette mask, checker-matte edge decontamination, fixed 1254 canvas, 704px subject width.
- Rejected edit: the direct transparent-background edit zoomed/reframed the creature and added a dark backdrop, so it was not used.

## Prompt

```text
Use case: stylized-concept
Asset type: production identity mother frame for a Phaser game monster animation pipeline
Input image: Image 1 is the strict identity, anatomy, facing-direction, and silhouette reference. Preserve the same creature; refine it rather than redesigning it.
Primary request: Create exactly one high-detail poison maggot monster in a calm, animation-friendly neutral idle pose.
Subject identity: preserve the reference creature's long heavy pale ivory segmented larval body, the same number and arrangement of swollen overlapping body segments, glossy near-black armored head capsule on the RIGHT, compact dark mandibles, the same arrangement of short black articulated hook-like legs along the underside, and the dark tail cap at the LEFT. Add only a very subtle sickly olive-green toxic moisture inside the mouth and between the mandibles, with no emitted liquid and no particles.
Anatomy and material: continuous physically plausible larval topology; every segment connected; legs attach cleanly to the underside and remain individually readable; believable heavy body weight and ground contact. High-detail moist wrinkled skin with restrained cream, gray-beige, and faint bruised undertones; hard black chitin with realistic roughness and small surface wear; no plastic-toy finish.
Style and medium: high-detail realistic PBR 3D game render, grounded dark-fantasy production asset, controlled saturation, strong readable silhouette; not a photograph and not a cartoon.
Pose: strict right-facing low three-quarter side view matching Image 1; horizontal heavy body; calm neutral idle; all underside contacts aligned on one baseline; head slightly raised enough to keep the mouth readable; no action and no spit.
Composition and camera: orthographic-style locked camera; exactly one complete subject; occupy about 56% of canvas width and about 43% of canvas height; center the body around 44% canvas width so there is generous empty space in front of the right-facing mouth for later attack animation; generous margins on every side; no cropping.
Scene and lighting: genuinely transparent background, no backdrop, no floor, no horizon, no cast shadow, no reflection; soft flat diffuse studio illumination only.
Identity locks: exact same species, body proportions, segment layout, black head and tail placement, leg topology, cream-white body palette, and right-facing direction as Image 1.
Avoid: redesign, model drift, extra or missing segments, extra or missing legs, duplicated or tangled legs, detached limbs, broken anatomy, armor, spikes, horns, tentacles, wings, human features, visible scenery, ground shadow, halo, cinematic rim light, motion blur, text, logo, watermark, cartoon, anime, chibi, low-poly, glossy plastic.
```
