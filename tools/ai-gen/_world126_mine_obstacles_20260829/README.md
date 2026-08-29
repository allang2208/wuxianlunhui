# World-126 mine obstacle candidates

This directory contains the minimal editable source chain for five approved V2 model and material candidates. They are candidate-only and are not installed into runtime assets.

## Selected candidates

- `mine_obstacle_collapsed_support`: `support_model_v2_realistic/candidates_klein_s48_from_model/.../mine_obstacle_collapsed_support_refine_v01_raw.png`
- `mine_obstacle_derailed_cart`: `candidates_klein_s48_from_v2_models/.../mine_obstacle_derailed_cart_refine_v01_raw.png`
- `mine_obstacle_stone_pillar`: `candidates_klein_s48_from_v2_pillar_r2/.../mine_obstacle_stone_pillar_refine_v01_raw.png`
- `mine_obstacle_hand_winch`: `candidates_klein_s48_from_v2_models/.../mine_obstacle_hand_winch_refine_v01_raw.png`
- `mine_obstacle_sorting_hopper`: `candidates_klein_s48_from_v2_models/.../mine_obstacle_sorting_hopper_refine_v01_raw.png`

`world126-mine-obstacles-v2-klein-final-candidates.png` is the final comparison sheet. `world126-mine-obstacles-v2-model-approval.png` is the approved V2 model overview.

## Reproduction contract

- Builders: `../build-world126-collapsed-support-v2.py` and `../build-world126-mine-obstacles-v2.py`; both reuse `../build-world126-mine-obstacles.py`.
- Candidate manifest: `world126-mine-obstacle-candidate-manifest.json`.
- Generator: `run-v2-klein-refine.py`.
- Explicit task exception: `flux2-klein-4b-depth`, 48 steps, Depth 0.82, denoise 0.30, direct from the approved textured V2 model render. This does not replace the project's global Dev default.

Before runtime promotion, create true-alpha cutouts, trim to the visible bottom edge, calibrate the visual footprint/collider, and check per-object front-edge depth ordering in the dungeon.
