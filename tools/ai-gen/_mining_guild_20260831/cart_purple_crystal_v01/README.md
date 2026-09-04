# 矿业工会02 · 纯紫色晶石矿车

后续状态：用户回复“可用，继续”确认本图，已作为正式素材入库；源图及生成祖先保留不覆盖。资源与功能接入边界见 `../runtime/asset-registration.json`，当前素材已登记、玩法尚未定义。

按用户“还是有点不对，矿车的矿石能否替换成纯紫色的晶石”，将选定48步02中的车内灰岩紫矿斑换成整块紫色切面晶体。交付 `mining_guild.png`（RGBA 877×691），整体展示 `mining_guild_preview.png`，局部展示 `cart_after_detail.png`。

沿用标准 `generate-world122-building-candidates.py` 的Dev+Depth局部蒙版精修，仅生成1张：48步、种子132361、CFG3.5、Depth0.75、Euler/simple。货物几何替换采用denoise0.75，并通过 `--allow-nonstandard` 如实记录偏离常规0.30精修；没有重建或改变建筑模型、相机、地台和占格。该次上传沿用AGENTS.md记录的同一局域网目的地授权。

最终只合入车内蒙版范围，内侧羽化0.45px；其余区域使用选定02原像素，Alpha及原紧裁框也直接复用。生成初稿的晶石高光过白、饱和度偏高，合成前仅对蒙版内紫色晶体与近白高光做确定性色彩收敛；原生成raw保留。车身和台面样石不改色。完整编辑来源、实际提示词、色彩参数和合成规则见 `provenance.json`。

- `prepare.py`：准备本轮提示词、参数与车内蒙版；不修改原02。
- `candidates/mining_guild/mining_guild_refine_v01_raw.png`：唯一一次生成的原图。
- `cargo_toned_generated.png`：仅晶石高光/紫色收敛后的直接合成来源。
- `finish.py`：局部色彩整理、合成及透明PNG导出。
- `cargo_mask.png` / `cargo_composite_mask.png`：生成和合成范围。

本轮仅交付素材修订，不自动接入游戏。未运行测试或运行时验证，按约定由用户测试；未构建、同步EXE、提交或推送。游戏内尺寸及缩小后的晶石辨识度仍待后续接入时确认。
