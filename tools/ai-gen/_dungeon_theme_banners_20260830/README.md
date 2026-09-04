# 地牢探索背景扩充（2026-08-30）

用户本轮明确要求新生成7张并全部导入；沿用此前矿洞背景与僵尸地牢参考，未另行要求选图。

- 工具：Codex内置image_gen，7次独立生成；未使用CLI/API后备、拼图、裁切、调色或重采样。
- 实际附带参考：`assets/scenes/dungeon-exploration-horror-v9.png`、`assets/scenes/dungeon-exploration-mine/mine-banner-01-rail-gallery.png`，生成前均已查看。
- 提示词目标3072×1024；实际每张2172×724（3:1），源像素原样复制到正式目录；每张提示词和完整来源路径见本目录及`manifest.json`。
- 三档废弃矿洞的`mapExplorationBackgroundVariants`从3张扩至10张；新一局等概率抽取，每张1/10，可连续重复。同一局返回房间或调整布局不重抽；其他地牢与旧地标母图池不动。
- 后续比例修复采用上方40%/下方60%与`object-fit: cover; object-position: center`，图片等比铺满、超出部分裁切，不拉伸；当前合同见探索台说明。
- 本次只查看生成图与局部代码差异；未运行测试或运行时验证、未同步EXE，游戏效果按约定由用户测试。

| 主题 | 正式原图 | 实际尺寸 | 原生成文件 |
|---|---|---|---|
| 锁链牢房 | [mine-banner-04-chain-prison.png](../../../assets/scenes/dungeon-exploration-mine/mine-banner-04-chain-prison.png) | 2172×724 | exec-be23bb27-2ddf-4e9f-8d1d-4bde9b5c41c2.png |
| 地下墓室 | [mine-banner-05-buried-crypt.png](../../../assets/scenes/dungeon-exploration-mine/mine-banner-05-buried-crypt.png) | 2172×724 | exec-fcff9d4b-ebda-4b15-96da-ac5afa63c2ac.png |
| 淹水泵房 | [mine-banner-06-flooded-pumpworks.png](../../../assets/scenes/dungeon-exploration-mine/mine-banner-06-flooded-pumpworks.png) | 2172×724 | exec-a020e990-aaba-4d35-97e6-394d89362544.png |
| 幽光菌窟 | [mine-banner-07-fungal-grotto.png](../../../assets/scenes/dungeon-exploration-mine/mine-banner-07-fungal-grotto.png) | 2172×724 | exec-2a8f134e-9746-4eda-b4f9-3281376e4119.png |
| 遗忘熔炉 | [mine-banner-08-forgotten-forge.png](../../../assets/scenes/dungeon-exploration-mine/mine-banner-08-forgotten-forge.png) | 2172×724 | exec-80f25055-cef5-411f-b4d5-b8deaed017a4.png |
| 封印圣所 | [mine-banner-09-sealed-sanctum.png](../../../assets/scenes/dungeon-exploration-mine/mine-banner-09-sealed-sanctum.png) | 2172×724 | exec-a66a51a0-b472-45d3-b941-ded3b95c619e.png |
| 地下湖码头 | [mine-banner-10-subterranean-harbor.png](../../../assets/scenes/dungeon-exploration-mine/mine-banner-10-subterranean-harbor.png) | 2172×724 | exec-b2510348-5f71-4099-a959-e7eb2b95a088.png |
