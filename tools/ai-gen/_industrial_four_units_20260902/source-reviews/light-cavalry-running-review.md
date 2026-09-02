# Industrial carbine cavalry running H3 source review

- Source: `industrial_carbine_cavalry/videos/running-h3-v01.mp4`
- Evidence: source contact and `light-cavalry-running-cycle-f0-f20.png`.
- Direction: pass; cat head, chest, hips, knees, paws, travel axis and rider/carbine remain screen-right.
- Identity: pass; one rider, one orange tabby cat, wooden carbine, bandolier, saddlebags, blanket and sheathed saber remain consistent. The expected cat tail is retained.
- Combat boundary: no muzzle flash, recoil, smoke or move-shooting.
- Cycle: raw frames 0–15 form one complete gallop and raw frame 16 is the reviewed return endpoint. Formal keys now retain every contiguous source frame from 0 through 15; one 2x RIFE pass produces 32 final frames at 48 fps.
- The opening pose is the single loop-repair target after endpoint comparison; seam delta / adjacent-frame mean is 0.405. One fixed action scale and root anchor are used with no per-frame fit, recenter or translation.
- Semantic matte cleanup removed border-connected light-stage residue without fixed-coordinate body erasure. The formal sheet has no blank/touching frames and zero RGB in transparent pixels.
- Verdict: passes formal offline audit; pending user GIF acceptance.
