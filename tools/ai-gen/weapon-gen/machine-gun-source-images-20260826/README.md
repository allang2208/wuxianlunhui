# 机枪正式贴图源图归档（2026-08-26）

本目录把原先留在忽略目录 `tools/ai-gen/_weapon_candidates/` 中、已经用于正式机枪批次的源图与最小后处理脚本迁入版本控制。运行时贴图、武器规格、现实枪械参考及生成提示词仍保留在各自的正式路径；这里不替代运行时资源。

## 已确认的重建关系

- `rpd-clean.png`、`m249-clean.png`、`ultimax100-clean.png`、`mg42-clean.png` 使用对应 `weapon-specs/*.json` 的布局，经 `add-weapon.py process-image --cutout-tool none --no-orient --no-auto-level` 规范化后，与现有 `assets/weapons/*-equip.png` 逐像素一致。
- 上述四张 `*-clean.png` 均可由同名 `*-raw.png` 和 `cleanup-enclosed-background.py`（默认 `--min-enclosed-area 1000`）逐字节重建。
- `singularity-loom-lmg-final.png` 使用相同规范化参数后，与现有奇点织机正式贴图逐像素一致；同目录 `provenance.json` 保存生成来源、提示词与正式路径。
- `fusion-core-lmg-cutout-v2.png` 可由 `fusion-core-lmg-raw-v1.png` 和清理脚本以 `--min-enclosed-area 2000` 逐字节重建。它属于熔核轻机枪的已采用来源链，但与当前正式贴图不是逐像素同版，因此只作为源图保全，不作为无损重建承诺。

正式路径与补充来源：

- 武器规格：`tools/ai-gen/weapon-specs/{rpd,m249,ultimax100,mg42,fusion-core-lmg,singularity-loom-lmg}.json`
- 现实枪械参考及来源：`tools/ai-gen/references/machine-guns/SOURCES.md`
- 正式贴图：`assets/weapons/*-equip.png`
- 背包图标的独立派生链：`tools/ai-gen/weapon-gen/machine-gun-inventory-icons-20260828/`

`manifest.json` 记录本次归档文件的字节数、SHA-256 和静态重建核对结果。运行重建命令会覆盖正式贴图，应仅在明确需要恢复资产时执行。
