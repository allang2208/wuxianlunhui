# Mouse Blacksmith Standing Idle — MiniMax H3 v01

Status: accepted asset installed into runtime; `assetOnly: false`, `runtimeIntegrationActive: true`.

## Selected delivery

- Source video: `videos/mouse-blacksmith-idle-h3-v01.mp4`
- H3 provenance: `videos/mouse-blacksmith-idle-h3-v01.mp4.json`
- Transparent source sheet: `final/mouse-blacksmith-idle-h3-v01-source.png`
- Formal RIFE v4.6 sheet: `final/mouse-blacksmith-idle-h3-v01-rife.png`
- GIF preview: `final/previews/mouse_blacksmith_idle_h3_v01-interpolated.gif`
- Contact sheet: `final/previews/mouse_blacksmith_idle_h3_v01-interpolated-contact.png`
- RIFE report: `final/mouse-blacksmith-idle-h3-v01-rife-report.json`
- Runtime sheet: `../../../../assets/npc/mouse_blacksmith/idle.png`
- Runtime manifest: `spritesheet-manifest.json`
- Reproducible installer: `install-runtime.ps1`

## Generation and extraction

- Provider: MiniMax H3 local pipeline (`minimax-h3-local`)
- Seed: `810820562`
- H3 output: 124 frames, 24 FPS, 1344 x 768, 5.17 seconds
- Reference: the same standing mother image is used at the first and last frame
- Selected source frames: 0 through 116, step 4; frame 120 is the excluded duplicate endpoint
- Transparent source: 30 frames, 512 x 512, 6 FPS, 8 columns
- Formal sheet: RIFE v4.6 loop interpolation, 60 frames, 512 x 512, 12 FPS, 8 columns

## Acceptance evidence

- Feet remain at y=499 in every selected source and formal frame.
- Torso anchor span is 1 px; lower-body anchor span is 4 px.
- Source loop seam ratio is 0.5000637 (allowed range 0.5 to 1.5).
- First/endpoint full-body alpha IoU is 0.9939741; leg-region IoU is 0.9954626.
- No empty frames, cell-edge touches, transparent-RGB residue, or visible dark/red/blue/cyan interpolation outliers.
- All 30 source keyframes are preserved unchanged at even formal-frame indices.

The earlier 31-frame extraction was rejected at seam ratio 0.49577 and removed from the formal archive. Use `source_sheet_v02/` and `final/` for review; this note preserves the rejection reason without retaining the failed sheet and duplicate previews.

## Runtime integration

- `BootScene` loads frames 0 through 59 and registers the idle loop at 12 FPS.
- The existing `npc_mouse_blacksmith_idle` animation key is preserved, so the neutral-NPC state path does not change.
- Runtime display size remains 196. The accepted sheet foot line at source y=499 maps to `footOffsetY: 93`.
- The click area is tightened to the standing character Alpha bounds (`120 x 186`).
- The old hammer-frame sound mapping is removed because the accepted animation contains no hammering action.
- Shop, dialogue, NPC identity, placement, depth sorting and interaction state logic are unchanged.
- The obsolete person-plus-anvil footprint is replaced by a standing-NPC footprint (`70 x 50`, radius `32.5`, y offset `-12.5`), so an invisible anvil no longer blocks approach.
