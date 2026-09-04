# Final prompts

Backend: Codex built-in `imagegen`.

References: `assets/weapons/guards/heaven-pillar-returning-bulwark-guard.png` and `assets/weapons/guards/abyss-return-star-devouring-mirror-guard.png` were used only for camera angle, isolated composition, material polish and transparent padding. Their identities were explicitly excluded.

## 逆命劫轮盾

```text
Use case: stylized-concept
Asset type: production identity mother image for a 2.5D action-RPG player shield
Primary request: create an original legendary shield named “逆命劫轮盾”, visually expressing delayed injury, causal debt, and fate reversal through one physically coherent defensive object.
Subject: a tall but agile hexagonal-kite shield, narrower than a pavise, constructed from blackened tungsten steel and dark oxblood obsidian laminate. Its exterior face has three interlocked articulated causal rings built into the armor plates, a vertical hourglass-shaped central spine, restrained pale-gold luminous channels, and a few deep crimson stress fissures trapped under the surface. The rings and spine must be mechanically attached, not floating. Strong legendary craftsmanship, readable solid armor, credible rim thickness, believable plate seams, rivets, and edge wear.
Composition/framing: square 1024-style game asset, complete shield centered with 8–12% transparent safety margin. Exact defensive three-quarter exterior view at approximately 42 degrees horizontal yaw: the virtual wielder is on image-left, so the LEFT rim is the near rim and clearly shows real thickness and a narrow side wall; the RIGHT rim is the far rim and visibly narrows. Exterior face remains readable. Natural vertical axis, no baked screen-plane tilt.
Style/medium: high-end realistic PBR game equipment render, dark fantasy science-fantasy, crisp silhouette, restrained emissive detail.
Color palette: blackened gunmetal, dark oxblood obsidian, muted antique gold, restrained pale-gold emission, very limited crimson fissures.
Scene/backdrop: genuinely transparent background.
Constraints: exactly one shield; true transparent RGBA; full object visible; no character, hand, arm, weapon, stand, floor, cast shadow, text, numbers, letters, logo, rarity frame, loose or floating parts, background scenery, or watermark.
```

## 完整资产批次

两盾分别以已确认的防御身份母图作为唯一身份参考，再生成以下同身份视图：

- 外侧近正面：自然竖直、完整主体、真实厚边，供`equipImage`和改造面板使用；不画背带、手臂或斜向屏幕倾角。
- 内侧背面：保留与外侧完全一致的轮廓、材质和构造，清楚展示握把、臂带、承力脊和真实厚边，供背面改造槽标定。
- 两张3×3冷钢改造图标母表：每格恰好一个实体组件，固定银钢方框、暗色圆盘、四角铆钉与克制蓝色边光；无文字、数字、箭头、整盾、人物或散件。

逆命劫轮盾九格顺序：劫时重板、纳债膜、安全卸债鳞、赦债命轮、延命刻环、急偿轮、沙漏配重握、强化臂带、紧急结算棘轮。

圣城终誓门九格顺序：城垒陶金板、誓光卸力瓦、储备电容晶、广域圣所镜、长誓棱镜、高流慈悲芯、快释誓闩、行军扶壁带、誓能泵握。

所有盾牌视图按方形独立游戏资产构图、8—12%安全边、透明或可边界连通去底背景生成；图标母表保持完整不裁格，随后由`prepare-assets.ps1`等分切片。

## 圣城终誓门

```text
Use case: stylized-concept
Asset type: production identity mother image for a 2.5D action-RPG player shield
Primary request: create an original legendary shield named “圣城终誓门”, visually expressing a final oath, a fortified sanctuary gate, and protection shared with nearby allies through one physically coherent defensive object.
Subject: a broad cathedral-gate pavise with a slightly tapered lower point, made from warm ivory ceramite armor slabs over an antique-gold structural frame. Two restrained wing-like side buttresses remain firmly attached to the main body, framing a closed central gate motif formed by solid layered plates. A vertical cyan crystal keystone and thin geometric azure ward channels suggest a deployable protective domain. Include credible thick rim construction, plate seams, recessed rivets, load-bearing ribs, small edge wear, and practical reinforcement. No religious text or real-world symbol. No floating halo and no detached pieces.
Composition/framing: square 1024-style game asset, complete shield centered with 8–12% transparent safety margin. Exact defensive three-quarter exterior view at approximately 42 degrees horizontal yaw: the virtual wielder is on image-left, so the LEFT rim is the near rim and clearly shows real thickness and a narrow side wall; the RIGHT rim is the far rim and visibly narrows. Exterior face remains readable. Natural vertical axis, no baked screen-plane tilt.
Style/medium: high-end realistic PBR game equipment render, noble science-fantasy fortress design, crisp silhouette, disciplined legendary ornament.
Color palette: warm ivory ceramic, aged antique gold and brass, restrained steel shadow tones, luminous cyan-blue crystal and fine azure channels.
Scene/backdrop: genuinely transparent background.
Constraints: exactly one shield; true transparent RGBA; full object visible; no character, hand, arm, weapon, stand, floor, cast shadow, text, numbers, letters, logo, rarity frame, loose or floating parts, background scenery, or watermark.
```
