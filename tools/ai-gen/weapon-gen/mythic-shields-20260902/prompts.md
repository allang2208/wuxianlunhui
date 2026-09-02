# 神话盾牌母图 V01 提示词

生成后端：Codex 内置 `image_gen`。两张图均为新生成，没有参考图输入。

## 天柱回天壁

```text
Use case: stylized-concept
Asset type: production identity mother concept sheet for a fantasy action-RPG shield
Primary request: create the definitive mother concept sheet for a mythic shield named “Heaven-Pillar Returning Bulwark” (天柱回天壁).
Subject and layout: show EXACTLY TWO large views of the SAME shield side by side on one square concept sheet: exterior FRONT view on the left, mechanically accurate BACK view on the right. No third view, no loose parts, no labels.
Front design: one tall broad mythic tower shield with clipped octagonal shoulders and a short centered lower point, clearly different from a heater shield. The face is constructed from massive overlapping black celestial-steel plates with subtle dark stone texture. A single imposing pale-gold vertical “world pillar” spine runs from crown to foot. Three nested segmented return-force rings are integrated into the face around the spine, made from aged white-gold and restrained cyan energy seams; use abstract geometric grooves only, never readable runes. Strong layered relief, realistic rivets and load-bearing joins. It should communicate immovable defense, storing the force of repeated blocks, then resetting for a precise parry. Mythic but mechanically believable for a humanoid offhand shield; no spikes.
Back design: unmistakably the rear of the exact same shield, preserving silhouette, thickness and materials. Show an integrated three-point shoulder/forearm suspension harness, one solid transverse dark-leather hand grip, a compact hydraulic recoil grip assembly, a circular reset winch aligned behind the front return ring, padded forearm cradle, and aged brass buckles. Every rear component is attached and physically usable; no hand or arm.
Style/medium: premium painterly-realistic dark-fantasy game equipment concept art, crisp PBR metal, stone and leather, high-end isometric inventory rendering, materially richer than epic-tier equipment without becoming science fiction.
Composition/framing: both complete shield views centered with generous margin, front slightly larger but both fully visible, shallow orthographic three-quarter presentation, clean separation, no cropping.
Lighting/mood: dark neutral studio backdrop, controlled cool key light with warm pale-gold highlights and restrained cyan inner glow, monumental and disciplined.
Color palette: black celestial steel, charcoal stone, aged white-gold, tiny cyan seams, dark brown leather.
Constraints: the exterior front must be unmistakable and visually dominant; the rear must not resemble the front. No character, hands, weapons, stand, floor, cast shadow, detached parts, extra shields, UI frame, text, letters, numbers, heraldic emblem, logo or watermark.
Avoid: generic medieval shield, thorn motifs, starburst lattice, oval mirror shield, bright neon, floating pieces, excessive ornament, skulls, wings.
```

## 归墟吞星镜

```text
Use case: stylized-concept
Asset type: production identity mother concept sheet for a fantasy action-RPG shield
Primary request: create the definitive mother concept sheet for a mythic shield named “Abyss-Return Star-Devouring Mirror” (归墟吞星镜).
Subject and layout: show EXACTLY TWO large views of the SAME shield side by side on one square concept sheet: exterior FRONT view on the left, mechanically accurate BACK view on the right. No third view, no loose parts, no labels.
Front design: one broad circular-to-rounded-hexagonal mythic mirror shield, clearly distinct from a tall oval or kite shield. A thick segmented cold-silver outer rim encloses a deep convex smoked-obsidian face. At the center is a recessed black-glass event-horizon aperture, surrounded by two asymmetric gravitational-lensing rings and six restrained radial sink channels. The aperture should appear to swallow incoming projectiles; show controlled violet-to-cyan optical depth and a very thin pale-silver rim light, not a literal space scene. The ring and channels must be physically integrated into the shield, with believable impact plates, joints and fasteners. It should communicate nullifying the first projectile and collapsing a brief incoming barrage. Mythic dark magic, but still grounded defensive equipment.
Back design: unmistakably the rear of the exact same shield, preserving silhouette, thickness and materials. Show one robust transverse black-leather hand grip, a padded offset forearm cradle, two integrated anti-mass suspension straps, a compact observation-reset ratchet, and a circular damped mechanism aligned behind the central event horizon. All components are attached, load-bearing and usable; no hand or arm.
Style/medium: premium painterly-realistic dark-fantasy game equipment concept art, crisp PBR obsidian glass, silver alloy and leather, high-end isometric inventory rendering, materially richer than epic-tier equipment without becoming science fiction.
Composition/framing: both complete shield views centered with generous margin, front slightly larger but both fully visible, shallow orthographic three-quarter presentation, clean separation, no cropping.
Lighting/mood: dark neutral studio backdrop; cold controlled light, restrained violet and cyan refraction inside the black glass, mysterious and precise.
Color palette: smoked black obsidian, cold silver, graphite steel, deep violet, tiny cyan highlights, black leather.
Constraints: the exterior front must be unmistakable and visually dominant; the rear must not resemble the front. No character, hands, weapons, stand, floor, cast shadow, detached parts, extra shields, UI frame, text, letters, numbers, readable runes, heraldry, logo or watermark.
Avoid: oval kite silhouette, starburst lattice, large gemstones, bright neon, sci-fi holograms, floating pieces, cosmic scenery, portal landscape, skulls, wings, generic round wooden shield.
```

## 正式分视图与改造图标（身份引用生成）

以下提示词均使用本包本地图片作为`referenced_image_paths`，没有把素材发送到其他外部服务。

### 天柱回天壁：外正面防御侧视

参考：`concept/heaven-pillar-returning-bulwark-concept-v01.png`

```text
Create a single production game-asset master of the SAME shield identity shown in the reference: the Heaven-Pillar Returning Bulwark, a tall mythic tower shield with black forged plates, pale gold vertical central spine, three nested pale-gold return arcs, fine cyan energy seams, the same angular top and pointed lower silhouette, same rivets and weathering. Change only the view. Show the shield in the exact defensive exterior three-quarter side view used by the game: an implied wielder stands on image-left behind the shield, so the LEFT rim is the near rim and clearly shows believable shield thickness, while the RIGHT rim is the far rim and visibly narrows; about 42 degrees horizontal yaw, vertically upright with no roll or top-down tilt. The exterior/front face and all three return arcs must face the camera; absolutely do not show the back, straps, handles, hands, person, stand, ground, shadow, text, labels, border, or multiple views. Center one complete shield on a square canvas with 8-12 percent transparent safety margin on all sides. Photorealistic high-detail dark-fantasy game inventory render, crisp material separation. TRUE TRANSPARENT RGBA background, no dark studio background, no checkerboard baked into pixels.
```

### 归墟吞星镜：外正面防御侧视

参考：`concept/abyss-return-star-devouring-mirror-concept-v01.png`

```text
Create a single production game-asset master of the SAME shield identity shown in the reference: the Abyss-Return Star-Devouring Mirror, a mythic oval shield with segmented black-violet obsidian mirror petals, bright violet starfield veins, a central black event-horizon pupil surrounded by concentric silver rings, the same eight silver gothic rim braces and pointed top/bottom silhouette, same material, wear and rivets. Change only the view. Show the shield in the exact defensive exterior three-quarter side view used by the game: an implied wielder stands on image-left behind the shield, so the LEFT rim is the near rim and clearly shows believable shield thickness, while the RIGHT rim is the far rim and visibly narrows; about 42 degrees horizontal yaw, vertically upright with no roll or top-down tilt. The exterior/front face and central event horizon must face the camera; absolutely do not show the back, straps, handles, hands, person, stand, ground, shadow, text, labels, border, or multiple views. Center one complete shield on a square canvas with 8-12 percent transparent safety margin on all sides. Photorealistic high-detail dark-fantasy game inventory render, crisp material separation. TRUE TRANSPARENT RGBA background, no dark studio background, no checkerboard baked into pixels.
```

### 天柱回天壁：近正面与背面

参考：对应正式防御侧视；背面同时参考身份母图。

```text
Using the referenced Heaven-Pillar Returning Bulwark as the exact identity and material reference, create one separate production presentation master of the SAME shield viewed almost straight from the exterior/front, only a very slight three-quarter perspective so the silhouette remains readable. Preserve exactly the tall angular tower-shield silhouette, black forged plates, pale-gold vertical central spine, three nested pale-gold return arcs, cyan energy seams, rivets, wear, proportions, and pointed bottom. The entire exterior/front face is visible and symmetrical enough for inventory/equipment presentation. Single complete shield only, centered upright, no back, no straps or handle, no person or hands, no stand, ground, cast shadow, text, labels, border, or multiple views. Square canvas, 8-12 percent transparent safety margin. Photorealistic high-detail dark-fantasy game asset. TRUE TRANSPARENT RGBA background; do not bake a checkerboard or studio background into the image.
```

```text
Create one dedicated REAR/BACK reference master of the exact same Heaven-Pillar Returning Bulwark identity shown in the references. Preserve the same tall angular tower-shield silhouette, black forged plate construction, pale-gold metal trim, rivet pattern, age and proportions. Show the inner/back face nearly straight-on, centered and upright. Include a believable mythic heavy-shield harness: two upper dark-brown leather forearm support straps, a central circular return-mechanism housing aligned behind the front concentric arcs, one horizontal leather-wrapped hand grip across the middle-right area, a lower padded forearm cradle, buckles and reinforcement rails. The grip must make it obvious where a left-side wielder's off hand would hold it, but show NO hand, arm, person, or body. Single shield only, no exterior/front face, no side-by-side views, no stand, ground, cast shadow, text, labels or border. Square canvas with 8-12 percent transparent margin and matched object scale to the exterior master. Photorealistic high-detail dark-fantasy equipment asset. TRUE TRANSPARENT RGBA background, no studio background or baked checkerboard.
```

### 归墟吞星镜：近正面与背面

参考：对应正式防御侧视；背面同时参考身份母图。

```text
Using the referenced Abyss-Return Star-Devouring Mirror as the exact identity and material reference, create one separate production presentation master of the SAME shield viewed almost straight from the exterior/front, only a very slight three-quarter perspective so the silhouette remains readable. Preserve exactly the oval pointed silhouette, segmented black-violet obsidian mirror petals, bright violet starfield veins, central black event-horizon pupil, concentric silver rings, eight gothic silver rim braces, wear, rivets and proportions. The entire exterior/front face is visible and close to symmetric for inventory/equipment presentation. Single complete shield only, centered upright, no back, straps, handle, person, hands, stand, ground, cast shadow, text, labels, border, or multiple views. Square canvas, 8-12 percent transparent safety margin. Photorealistic high-detail dark-fantasy game asset. TRUE TRANSPARENT RGBA background; do not bake a checkerboard or studio background into the image.
```

```text
Create one dedicated REAR/BACK reference master of the exact same Abyss-Return Star-Devouring Mirror identity shown in the references. Preserve the same oval pointed silhouette, blackened silver gothic rim, rivets, age and proportions. Show the inner/back face nearly straight-on, centered and upright: matte black forged inner plate with subtle engraved star maps, concentric mechanical rings aligned behind the front event horizon, a small violet lens at the center, a sturdy horizontal black leather-wrapped hand grip across the upper-middle, two vertical black leather forearm straps with buckles, a lower padded arm cradle, and a small observation-reset ratchet near the upper center. The grip and straps must make the actual hand/forearm holding points unambiguous, but show NO hand, arm, person or body. Single shield only, no exterior/front face, no side-by-side views, no stand, ground, cast shadow, text, labels or border. Square canvas with 8-12 percent transparent margin and matched object scale to the exterior master. Photorealistic high-detail dark-fantasy equipment asset. TRUE TRANSPARENT RGBA background, no studio background or baked checkerboard.
```

### 天柱回天壁：3×3改造图标表

参考：正式近正面图、`assets/icons/craft-cold-steel/alloy_grip.png`。

```text
Create one EXACT 3 by 3 sprite sheet of nine separate square craft-modification icons for the Heaven-Pillar Returning Bulwark. Match the shield's black forged steel, pale gold, cyan energy and mythic return-arc identity; match the cold-steel UI icon rendering and dark riveted square frame. Equal-size cells, perfectly aligned rows/columns, no gaps or outer labels, one centered object per cell, no text, letters, numbers, hands, people or shield silhouettes. Row 1: layered mythic armor plate stack; interlocking force-dissipation lamella; fast-converging triple return-arc rune. Row 2: elongated return ring; reverse-time mechanical ring; mountain-shaped shield spine/ram. Row 3: hydraulic shield grip with cyan vial; crossed suspension straps; compact reset winch and ratchet. TRUE RGBA transparent background around the nine framed cells.
```

### 归墟吞星镜：3×3改造图标表

参考：正式近正面图、`assets/icons/craft-cold-steel/alloy_grip.png`。

```text
Create one EXACT 3 by 3 sprite sheet of nine separate square craft-modification icons for the Abyss-Return Star-Devouring Mirror. Match the shield's black-violet obsidian mirror, silver gothic braces, violet starfield and event-horizon identity; match the cold-steel UI icon rendering and dark riveted square frame. Equal-size cells, perfectly aligned rows/columns, no gaps or outer labels, one centered object per cell, no text, letters, numbers, hands, people or complete shield silhouettes. Row 1: singularity armor petal; star-devouring prism membrane; absolute-zero coating vial and plate. Row 2: expanded event-horizon ring; fast-collapse ring; deep-well energy reservoir. Row 3: phase support strap; anti-mass grip; observation-reset ratchet with violet lens. TRUE RGBA transparent background around the nine framed cells.
```
