# Brown bear animation pipeline status

Date: 2026-08-24
Status: complete

## Accepted sources

- Mother frame: `mother/brown-bear-mother-512.png`
- Doubao idle source: `video/brown-bear-idle-v2.mp4`
- Doubao walking source: `video/brown-bear-walking-v2.mp4`
- Doubao attacking source: `video/brown-bear-attacking-v3.mp4`
- Doubao dying source: `video/brown-bear-dying.mp4`
- Contact sheets: `previews/brown-bear-*-contact.png`
- Prompts and per-video provenance: `prompts/`, `video/*.mp4.json`

## Accepted runtime sheets

- `../../../assets/enemies/brown_bear/idle.png`
  - 12 frames, 6x2, 512x512 cells, 3 FPS
- `../../../assets/enemies/brown_bear/walking.png`
  - 22 frames, 6x4, 640x512 cells, 12 FPS
- `../../../assets/enemies/brown_bear/attacking.png`
  - 21 frames, 6x4, 896x512 cells, 950 ms, one-shot
- `../../../assets/enemies/brown_bear/dying.png`
  - 21 frames, 6x4, 640x512 cells, 1800 ms, one-shot

Each action normalizes its neutral first frame to the same 262 px target body
height, then keeps that action scale fixed; this is required because the attack
source deliberately uses a wider safety framing than idle/walking. All sheets use
footY 410. The attacking sheet preserves source-space lunge motion; the dying
sheet is grounded per frame. Blank frames, edge hits, semi-transparent pixels,
and non-black RGB inside transparent pixels are all zero. V3 interpolation
artifact frames 58~61 were excluded and replaced with clean frame 62.

Post-fix visible-height audit: idle first/median 258/259 px, walking 258/261 px,
attacking 254/248 px. The attacking low point of 220 px is the intentional crouch
and pounce posture, not a per-action scale mismatch.

## Attack framing correction

- Rejected V1 and V2 sources, provenance sidecars, and their obsolete audit
  previews were removed after V3 acceptance. V1 clipped the muzzle at the source
  edge; V2 left only a 10 px right margin, so neither may be used for rebuilding.
- Accepted V3 uses `video/brown-bear-reference-wide-v2-white.png`: the mother
  subject occupies 50% of the reference width and is anchored at x=36%, leaving
  directional room for the right-facing lunge.
- Full 121-frame source audit at 720x720 passes the 10% safety frame: minimum
  margins are left 75 px, right 87 px, top 263 px, bottom 211 px. The most
  constrained right-side frame is source frame 44.
- Source-audit entry: `../video-source-margin-audit.py`; reusable safe-reference
  entry: `../video-safe-reference.py`.

Quantitative report: `sheet-manifest.json`
Animated previews: `previews/final/*.gif`
Rebuild entry: `build-sheets.py`

## Runtime registration

- Enemy id: `brownBear`
- Rank/type: `normal` / `普通`
- Family: `动物`
- Factory: `createBrownBear`
- Movement logic maps `run` to the same pure walking animation because this
  four-action request intentionally has no separate running sheet.
- Registered in `ZOMBIE_FACTORY_MAP` for shared factory/collision-editor use.
- Added to all swamp dungeon `poolKeys`; with `matchPoolRanks: true`, it shares
  normal slots with `blackWolf` while elite/lord slots select their own ranks.

No game, build, lint, or browser runtime validation was run.
