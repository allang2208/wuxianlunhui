# Industrial heavy lancer charging H3 v01 rejected source review

- Historical source: `gunpowder_explosive_lancer/videos/charging-h3-v01.mp4` (rejected binary removed during the 2026-09-02 closeout; metadata, prompt and this review remain).
- Evidence: source contact and `heavy-cavalry-charging-f0-f64-step2.png`.
- Direction and identity: pass; one armored rider and one armored silver-gray tabby cat remain screen-right with one intact traditional lance.
- Motion: raw frames 0-20 retain a lowered-lance buildup; raw frame 22 starts the visible acceleration and frames 32-64 carry a continuous fast gallop. Head, chest, hips, knees, paws and travel axis agree.
- Hit window: raw frame 40 is the first fully extended airborne surge and maps to one-based runtime frame 31. The usable collision window continues through final frame 55 (raw frame 64).
- Forbidden features: no explosion, flame, rocket, powered assist, mechanical mount, extra rider or detached lance appears.
- Formal selection: `[0, 4, 8, 12, 16, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64]`.
- Runtime clock: one 2x interpolation yields 55 frames at 22.916667 fps, exactly matching the 2.4-second charge duration without looping.
- Rejection discovered during the later full-cycle review: the source never returns to the raised-lance ready pose. It can only supply a lowered-lance gallop segment, so it cannot satisfy `idle → sprint → attack → recover → idle` by recutting. The listed selection is historical evidence only and is superseded by `charging-h3-v02.mp4`.
- Verdict: rejected; do not use for formal processing.
