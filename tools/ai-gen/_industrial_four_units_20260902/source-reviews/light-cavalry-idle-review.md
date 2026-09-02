# Industrial carbine cavalry idle H3 source review

- Source: `industrial_carbine_cavalry/videos/idle-h3-v01.mp4`
- Evidence: source contact and `light-cavalry-idle-approved-window-f96-f123.png`.
- Direction and identity: pass in the approved window; one screen-right rider on one orange tabby cat, with carbine, bandolier, saddlebags, blanket and sheathed saber retained.
- Rejection boundary: raw frames 0–101 raise and fire the carbine and are excluded from the idle action.
- Approved window: raw frames 102–123 form a quiet low-ready halt. All four paws remain planted; there is no muzzle flash, smoke, recoil or step.
- Formal selection: `[102, 105, 108, 111, 114, 117, 120, 123]`, one fixed transform, 2x loop interpolation, 8 fps runtime.
- Verdict: pass for formal processing using only the recorded clean window.
