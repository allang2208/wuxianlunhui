# Industrial heavy lancer idle H3 source review

- Source: `gunpowder_explosive_lancer/videos/idle-h3-v01.mp4`
- Evidence: source contact and `heavy-cavalry-idle-approved-window-f88-f123.png`.
- Rejection boundary: raw frames 0–87 lower the lance into an attack/brace pose and are excluded from idle.
- Approved window: raw frames 88–123 retain one armored rider, one armored silver-gray tabby cat, red saddle cloth and one complete traditional lance at the approved relaxed upward carry angle.
- Direction and motion: head, chest, hips, paws and lance remain screen-right; all four paws stay planted, with only restrained breathing/weight motion. No attack, charge, wing, rocket, fire, explosion or powered device appears.
- Formal selection: `[88, 92, 96, 100, 104, 108, 112, 116, 120, 123]`, one fixed transform, 2x loop interpolation, 20 final frames at 8 fps.
- Verdict: pass for formal processing using only the recorded clean window.
