# Building visual refresh handoff (2026-08-27)

## Steam power plant

- `steam_power_plant_original_for_manual_cutout.png`
- Exact copy of the accepted 48-step v02 green-screen raw.
- Handoff only; the current runtime asset was not changed.

## Wind power plant body candidate v01

- `wind_power_plant_body_candidate_v01.png`
- Built-in image edit from `assets/terrain/wind_power_plant_body.png`.
- Static body candidate only. The existing independent 24-frame rotor sheet and animation configuration were not changed.
- Prompt contract: retain the isometric view and rotor mounting role; regenerate a compact PBR wind-power station body; transparent background; no rotor blades or readable text.
- Candidate only; not promoted to `assets/terrain/` pending user selection and rotor-alignment review.

## Grand mall sign candidate v02

- `grand_mall_sign_candidate_v02.png`
- Built-in image edit from the current grand mall, followed by one targeted correction of the sign panel.
- Prompt contract: rigid straight red plaque with aged-gold border; irregular decorative pseudo-lettering contained inside the plaque; no readable word.
- `grand_mall_sign_only_candidate_v02.png` is the bounded composite over the current runtime body. It keeps the existing rigid plaque, gold frame, building pixels, and alpha, and replaces only the inset red face.
- Candidate only; not promoted to `assets/terrain/` pending user selection.

## Grand mall sign alignment candidate v03

- `grand_mall_sign_only_candidate_v03.png`
- Built-in precise-object edit produced `grand_mall_sign_aligned_source_v03.png`; `rotate_grand_mall_sign_candidate.py` feature-aligns that donor to v02 and transfers only the sign-area patch.
- Prompt contract: change only the full red-and-gold sign; keep it rigid and planar; make its top and bottom edges parallel to the right-facade floor/cornice lines; preserve the building, entrance, framing, and transparency.
- This superseded v02 for review and was selected for runtime promotion on 2026-08-27.

## Runtime promotion (2026-08-27)

- Steam power plant: the user-corrected `steam_power_plant_original_for_manual_cutout.png` is the accepted RGBA source for `assets/terrain/steam_power_plant.png`; its alpha was preserved exactly during tight-crop finalization.
- Wind power plant: `wind_power_plant_body_candidate_v01.png` was accepted for the static body. The baked checkerboard was converted deterministically to `wind_power_plant_body_accepted_rgba_v02.png`, then finalized into `assets/terrain/wind_power_plant_body.png`. The full panel, independent 24-frame rotor sheet, timing and runtime rotor offsets remain unchanged. `wind_power_plant_body_alignment_preview.png` records the retained offset alignment.
- Wind footprint: the runtime logical footprint was expanded from 2×2 to 4×4 on 2026-08-27. Its strict ground-fit record was regenerated against the resulting 512×256 footprint without changing the accepted body or rotor assets.
- Grand mall: `grand_mall_sign_only_candidate_v03.png` is the accepted source for `assets/terrain/grand_mall.png`.
- Steam and grand-mall thumbnails, ground-fit records and lighting maps were regenerated. Wind updated only its body ground-fit and body metadata because its panel and rotor remain separate assets.
