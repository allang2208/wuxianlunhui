# 传说轻机枪 ImageGen 资产记录（2026-08-27）

## 生成方式

- 生成器：Codex 内置 `imagegen`，透明背景 PNG；没有调用外部账号、网页生成器或第三方素材。
- 原则：只借鉴“异域武器的节奏触发”和“传奇词缀改变玩法并可组合”的设计方法，不复刻现有游戏的名称、标志、轮廓或专有视觉元素。
- 原始文件：`raw/`；正式运行时文件位于 `assets/weapons/`、`assets/icons/`、`assets/terrain/`。

## 武器提示词

### 天穹测绘者

> Original legendary science-fantasy light machine gun, strict right-facing side profile, long heavy LMG silhouette, midnight navy metal, weathered ivory ceramic panels, aged brass astrolabe rings and meridian instruments integrated into the receiver, restrained cyan starlight conduits, box magazine, practical stock and barrel, intricate physically based game-asset materials, isolated single object, transparent background, no hands, no person, no text, no logo, no existing franchise weapon, no front-facing muzzle perspective.

### 冥约颂炮

> Original legendary dark-fantasy light machine gun, strict right-facing side profile, long heavy LMG silhouette, blackened steel, oxblood enamel, bone-inlay rune tablets, aged brass reliquary mechanics, restrained ember glow inside vents, box magazine, practical stock and barrel, intricate physically based game-asset materials, isolated single object, transparent background, no hands, no person, no text, no logo, no existing franchise weapon, no front-facing muzzle perspective.

## 改造图标提示词组

每枚图标均使用同一结构合同：`one original standalone mechanical weapon modification, readable 3/4 product icon, PBR material, centered, transparent background, no weapon, no hands, no text, no logo, no franchise symbol`。天穹组使用午夜蓝、象牙、黄铜、青色星光及星盘/棱镜/继电器语汇；冥约组使用黑铁、暗红、骨质、旧黄铜、余烬光及刻针/钟舌/经卷语汇。六枚图标逐件生成，未从同一大图切割。

## 后处理

- `finalize-assets.py` 从主武器透明贴图的枪口侧 40% 构造 625×300 防御塔枪管。
- 12 枚改造原图按 Alpha 包围盒紧裁、方形透明画布居中并缩放为 256×256。
- 正式玩家贴图与物品图标由项目现有 `add-weapon.py process-image` 流程生成，保留原始比例并置于 2048×2048 透明画布。
