# 陷阱提示词模板（世界-122 防守地图，2026-08-07 新增）
> 目标：F→A 六档 × 4 类地面陷阱（地刺 spike / 地雷 mine / 减速带 tar / 燃烧区 burn）。
> 视角基准 = 游戏等距地面物件：**平贴地面、顶面可见、30° 俯视**（与掩体 30° 底边斜墙
> 同视角体系，但陷阱是平铺物件，强调"从上方俯视看到顶面/内部"，不是立墙）。
> 入库：`assets/terrain/trap_<type>_<grade>.png`，显示尺寸 70~92 × 50~68（见 trap-config.js）。

## 风格基准（固定共用，与 cover.md/obstacle.md 同源）
```text
game asset prop, photorealistic 3D render, dark realistic materials,
flat diffuse ambient lighting, no light source, no shadows, no drop shadow,
centered composition, isolated on plain pure white background, high detail,
no text, no watermark
```

## 视角块（四类共用，必选）
```text
game asset prop, 2.5D isometric view matching the game's wall perspective,
the trap stands on a floor line tilted 30 degrees, bottom edge aligned at
exactly 30 degrees to the horizontal, front face visible, top surface slightly
visible and foreshortened, low profile, single prop centered in frame,
flat bottom, no wall, no stand
```

## 负面词（固定共用）
```text
blurry, low quality, watermark, text, signature, gradient background, gray background,
dark background, vignette, frame, border, people, hands, grass, floor texture,
shadows, drop shadow, cast shadow, hard lighting, directional light, rim light,
multiple objects, lineup, duplicate, top-down orthographic view, side view
```

## 主题词（按类型 × 档位替换；材质逐档递进）

### 地刺 spike
| 档位 | 主题 |
|---|---|
| F | `simple wooden spike trap on the ground, short sharp wooden spikes protruding from a flat wooden base, weathered pale wood` |
| E | `iron spike trap on the ground, rusty iron spikes on a flat metal base plate, coarse dark iron` |
| D | `stone spike trap on the ground, heavy rough stone spikes on a flat stone base, mossy joints` |
| C | `steel spike trap on the ground, sharp polished steel spikes on a reinforced steel plate, riveted corners` |
| B | `armored spike trap on the ground, dark armored metal spikes with a heavy reinforced base, battle-worn steel` |
| A | `rune spike trap on the ground, black enchanted steel spikes with faint glowing energy runes on the base, advanced magical fortification` |

### 地雷 mine
| 档位 | 主题 |
|---|---|
| F | `simple landmine on the ground, crude flat iron disk with a small pressure trigger knob, rusty pale metal` |
| E | `riveted landmine on the ground, iron disk mine with visible rivets and a center trigger, coarse dark metal` |
| D | `cast-iron landmine on the ground, heavy cast iron dome mine with a large pressure plate, worn dark finish` |
| C | `reinforced landmine on the ground, steel dome mine with reinforced ribs and a prominent trigger, dark military steel` |
| B | `armored landmine on the ground, layered armor-plate mine with a glowing warning strip, heavy battlefield steel` |
| A | `rune landmine on the ground, black arcane metal mine with glowing blue energy runes and a pulsing core, advanced magical trap` |

### 减速带 tar
| 档位 | 主题 |
|---|---|
| F | `small sticky tar puddle on the ground, a shallow dark tar patch with a glossy wet surface, organic black pitch` |
| E | `wide tar slick on the ground, dark sticky tar spreading flat with glossy highlights, thick black pitch` |
| D | `asphalt tar trap zone on the ground, a flat dark asphalt-tar area with a sticky glossy surface, road-grade pitch` |
| C | `reinforced tar trap zone on the ground, dark tar patch outlined by a low stone rim, sticky glossy surface` |
| B | `magical tar trap zone on the ground, dark viscous tar pool with faint purple glow veins, enchanted binding pitch` |
| A | `runed tar trap zone on the ground, black arcane tar pool with glowing blue runes around the rim and a shimmering surface, advanced magical binding trap` |

### 燃烧区 burn
| 档位 | 主题 |
|---|---|
| F | `small burning ground patch, a small campfire-like flame area on the ground, orange fire with a few embers` |
| E | `burning ground zone, a flat burning patch of orange-red flames on the ground, scattered embers` |
| D | `intense burning ground zone, a larger flat fire area with bright orange flames and rising heat, scorched ground` |
| C | `high-temperature burning ground, vivid yellow-white flames on a scorched black ground patch, intense heat glow` |
| B | `magical burning ground, blue-white arcane flames on the ground with a soft glow, enchanted fire trap` |
| A | `runed burning ground, black scorched ground with a ring of glowing runes and tall blue-violet arcane flames, advanced magical fire trap` |

## 拼接（顺序固定）
```text
<主题词> + <视角块> + <风格基准>  →  ComfyUI --negative <负面词>
```

## 验收
1. GLM-4.6V：主体为对应陷阱类型、平贴地面、顶面可见（30° 俯视）、单件居中、无文字水印。
2. 像素统计：`tools/ai-gen/prep-obstacle.py` 抠图后内容框占比合理（地雷/减速带偏平宽，
   地刺/燃烧区高度略高），连通域=1。
3. 入库：`assets/terrain/trap_<type>_<grade>.png`（白底抠图 → 透明底）。
