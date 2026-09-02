# Industrial carbine cavalry attacking H3 source review

- Source: `industrial_carbine_cavalry/videos/attacking-h3-v01.mp4`
- Evidence: source contact and `light-cavalry-attacking-event-f28-f48.png`.
- Direction and identity: pass; rider, cat, carbine and mounted equipment remain screen-right and intact. The cat keeps all four paws planted throughout the shot.
- Event: exactly one firing event begins at raw frame 33. Frame 33 carries the compact attached flash; raw frames 34–58 contain an oversized generated flash/smoke cloud and are excluded. Raw frame 59 resumes at only the fading smoke tail.
- Formal selection: `[0, 8, 16, 24, 30, 32, 33, 59, 64, 70, 80, 92, 108, 123]`; release raw frame 33 maps to one-based runtime frame 13 after one 2x interpolation.
- Runtime clock: 27 final frames at 12.1 fps plus the AI's 60 ms closeout remains within the 2.3-second attack interval.
- Recovery: one-way playback followed by normal idle; no wrap and no moving shot.
- Verdict: pass for formal processing.
