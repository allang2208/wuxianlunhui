# Industrial heavy lancer running H3 source review

- Source: `gunpowder_explosive_lancer/videos/running-h3-v01.mp4`
- Evidence: source contact and `heavy-cavalry-running-cycle-f0-f28.png`.
- Direction and identity: pass; one armored rider and armored silver-gray tabby cat remain screen-right, with coherent reins, red saddle cloth and one complete straight traditional lance.
- Motion: cat head, chest, hips, knees, paws and travel axis agree. The earlier raw 0–20 selection was invalid: frames 0–4 are an H3 opening hold, so it produces a visible pause every loop despite a superficially acceptable average seam score.
- Forbidden features: no thrust, impact, wing, rocket, explosion, fire or powered device appears.
- Corrected source cycle: every contiguous raw frame from 50 through 62; raw frame 63 is the reviewed same-phase endpoint and is used only as the RIFE transition target. Evidence: `heavy-cavalry-running-cycle-f50-f63.png`.
- One 2x RIFE pass produces 26 frames at 48 fps. One fixed action scale and root anchor are used with no per-frame fit, recenter or translation.
- Semantic matte cleanup removed border-connected light-stage residue without fixed-coordinate body erasure. The formal sheet has no blank/touching frames and zero RGB in transparent pixels.
- Verdict: the rebuilt transparent loop passes the strengthened offline audit: seam ratio `1.264`, longest near-frozen transition streak `0`, 26 contiguous frames at 48 fps. User GIF acceptance remains pending.
