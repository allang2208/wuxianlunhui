# Chain restaurant delivery worker animation status

Status: user accepted the three previews and the final sheets are installed as
the chain restaurant delivery worker runtime assets.

## Accepted candidate sources

- Idle keeps the user-approved six ImageGen key poses. RIFE v4.6 preserves
  those keys at even indices and expands the loop to 12 frames at 12 FPS.
- Empty-handed running uses Doubao Seedance 2.0 Mini V2. V1 was rejected because
  it rotated toward a frontal view and was removed during archive cleanup. V2
  uses the right-facing action keyframe and source window `[48,72)`, sampled
  every two source frames.
- Loaded running uses Doubao Seedance 2.0 Mini V1. It keeps two stable stacked
  meal crates and uses source window `[52,84)`, sampled every two source frames.

Both Doubao sources invented a long mouse-like tail even after the prompt
explicitly forbade one. `build-doubao-running-sheets.py` removes only the thin
rear-lower branch while preserving the satchel, coat, legs, shoes and a small
proximal tail stub. The source MP4 files remain unchanged.

## Final candidate contract

| State | Frames | FPS | Grid | Cell | Foot Y |
| --- | ---: | ---: | --- | --- | ---: |
| idle | 12 | 12 | 4x3 | 512x512 | 479 |
| empty_running | 24 | 24 | 6x4 | 512x512 | 479 |
| loaded_running | 32 | 24 | 8x4 | 512x512 | 479 |

All three RIFE reports contain zero empty frames, zero touching frames, fixed
alpha bottom 479, zero RGB values under fully transparent pixels, and exact
preservation of the original key frames at even output indices.

## Runtime integration

The three sheets are copied to `assets/companions/hamster_delivery_worker/` as
`idle.png`, `empty_running.png`, and `loaded_running.png`. The
`data/population-economy.json#chain_restaurant.workerVisual` entries now point to
those files with frame contracts `12@12`, `24@24`, and `32@24`. The baker sheets
are no longer referenced by the chain restaurant. Runtime/game validation remains
the user's step unless explicitly authorized.
