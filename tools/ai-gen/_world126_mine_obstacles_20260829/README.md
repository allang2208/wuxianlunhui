# World-126 mine obstacle candidates

This directory contains the minimal editable source chain for five approved V2 model and material candidates, plus the runtime-promotion metadata for the accepted V01 set.

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

## Runtime promotion

The five accepted V01 images were finalized with `finalize-isometric-obstacle-imagegen.py --margin 6 --despill-green`, producing tight BiRefNet RGBA cutouts under `assets/terrain/abandoned-mine-obstacles/`. `runtime-promotion.json` records the final source dimensions, display heights, calibrated footprint rectangles and footprint-front-edge depth rule.

Runtime placement is limited to the World-126 `scene12` loader. Formal and development instances reuse the current abandoned-mine continuous floor and visual-only floor props; the five collidable obstacles use the logical world generation seed, preserve player/portal clearance, avoid footprint overlap and boundary collision, and retain the approved non-flipped view.
