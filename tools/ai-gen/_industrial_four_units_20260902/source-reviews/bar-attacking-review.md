# BAR automatic rifleman attacking H3 source review

- Source: `emplaced_machine_gun_crew/videos/attacking-h3-v01.mp4`
- Evidence: `bar-attacking-event-f22-f66.png` and `bar-attacking-frame-by-frame-f24-f72.png`
- Direction: pass; head, torso, hips, feet and muzzle remain screen-right.
- Identity: pass; one BAR gunner with canvas backpack and carried ammunition belt, no assistant, tripod, radio or emplacement.
- Source event audit: visible muzzle events occur at raw frames 30, 42, 57 and 65. The first three are retained as the gameplay burst; the fourth is deliberately omitted from the formal selection.
- Formal source release frames: 30, 42 and 57, placed at source-key positions 5, 7 and 9. After one 2x interpolation these map to one-based runtime frames 9, 13 and 17.
- Runtime cadence: `13.333333 fps`; four runtime frames between release events equals 300 ms.
- Recovery: one-way; no wrap. Selection jumps from raw frame 63 to 72 so the unneeded fourth flash is not visible.
- Verdict: pass for formal processing with the recorded frame selection.
