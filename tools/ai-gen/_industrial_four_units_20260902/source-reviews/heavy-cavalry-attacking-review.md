# Industrial heavy lancer attacking H3 source review

- Source: `gunpowder_explosive_lancer/videos/attacking-h3-v01.mp4`
- Evidence: source contact and `heavy-cavalry-attacking-event-f40-f72.png`.
- Direction and identity: pass; one armored rider and one armored silver-gray tabby cat remain screen-right, with one complete traditional lance and no identity split.
- Motion: raw frames 40-60 form a continuous forward press. The lance and rider reach maximum extension at raw frame 59 without a teleport, reverse step or detached weapon.
- Forbidden features: no explosion, gunpowder blast, rocket, powered assist, mechanical mount or extra rider appears.
- Formal selection: `[0, 8, 16, 24, 32, 40, 48, 56, 59, 64, 72, 84, 100, 112, 123]`; impact raw frame 59 maps to one-based runtime frame 17 after one 2x interpolation.
- Runtime clock: 29 final frames at 14 fps plus the AI's 60 ms closeout remains within the 2.2-second normal attack interval.
- Recovery: one-way playback followed by normal idle; no wrap.
- Verdict: pass for formal processing.
