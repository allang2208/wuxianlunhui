# 位面特色单位科技图标

- 生成器：Codex 内置 ImageGen
- 日期：2026-08-26
- 风格参考：`desert_mansion_charter.png`、`jungle_temple_rites.png`、`snow_ninjutsu.png`
- 角色参考：`assets/companions/desert_priest/idle.png`、`assets/companions/jungle_priest/idle.png`

## desert_monastic_order

以现有白色包头长袍、日轮挂饰、木杖的仓鼠角色为身份真源，制作冷钢尖角六边形科技徽章；内部使用深炭色切面，辅以克制的金色日轮和流沙光带。无文字、无额外角色，六边形外透明。

## jungle_priesthood

以现有深绿叶羽祭服、绿松石螺旋法杖的仓鼠角色为身份真源，制作冷钢尖角六边形科技徽章；内部使用深炭色切面，辅以克制的翠绿叶片和自然灵光。无文字、无额外角色，六边形外透明。

## 后处理

原始生成图保留在 `raw/`。`finalize_icons.py` 按徽章外轮廓生成确定性六边形 Alpha，归一化到 1024×1024 RGBA，并将可见徽章控制在 1000px 安全框内。
