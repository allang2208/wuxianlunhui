# Industrial heavy lancer dying H3 source review

- Source: `gunpowder_explosive_lancer/videos/dying-h3-v01.mp4`
- Evidence: source contact and `heavy-cavalry-dying-f20-f76-step2.png`.
- Direction and identity: pass; one armored rider, one armored silver-gray tabby cat and one traditional lance remain coherent throughout the fall.
- Motion: raw frame 24 keeps a readable upright lead-in; raw frame 32 begins the loss of strength, frames 38-70 carry the uninterrupted collapse, and the later frames settle into a stable grounded corpse.
- Forbidden features: no recovery, reverse rise, cut, teleport, explosion, powered effect, extra rider or extra mount appears.
- Formal selection: `[24, 32, 38, 42, 46, 50, 54, 58, 62, 66, 70, 76, 86, 98, 110, 123]`; one 2x interpolation yields 31 frames at 16 fps.
- Vertical policy: retain the authored fall and ground contact; no per-frame recentering and no wrap interpolation.
- Verdict: pass for formal processing.
