# 工头甩鞭交付（2026-08-31）

用户确认“修复”后已接入开发版；角色是`foremanZombie`，与农场员工无关。未同步EXE。旧候选与旧评审参数保留作来源记录，当前接入以`runtime-manifest.json`为准。

## 当前文件

- [四方向动画GIF](previews/foreman-whip-runtime-directions.gif)
- [八方向接触图](previews/foreman-whip-runtime-eight-directions.png)
- [待机衔接图](previews/foreman-whip-runtime-transitions.png)
- [正式人体/衔接精灵表](../../../assets/enemies/foreman_zombie/attacking_doubao_body.png)
- [豆包第4条源视频](videos/whip-v04.mp4)及[来源记录](videos/whip-v04.mp4.json)
- [运行时清单](runtime-manifest.json)
- [接入说明](../../../docs/foreman-whip-alignment-2026-08-31.md)

GIF使用正式PNG和生产代码`projectForemanWhip`导出的投影点，画面为80%显示比例；循环首尾各加250ms停留便于查看，游戏动作仍为1500ms一次性播放。GIF时长按10ms量化，精确事件时间以JSON为准。这些是离线素材预览，不是游戏内截图或运行时验收。

## 素材与时钟

| 项目 | 接入值 |
| --- | --- |
| 攻击格/排列/整表 | 352×320；7列9行；2464×2880；61有效帧，末2格为空 |
| 脚点 | 140,304；固定所有帧，不逐帧居中 |
| 像素比例 | X/Y均480/512=0.9375；显示画布330×300 |
| 人物尺度 | 标定中性主体268素材像素，约251.25世界像素；姿态变化不用于重新缩放 |
| 攻击时长 | 1500ms；前36帧各24.19355ms，后25帧各25.16129ms |
| 命中/音效 | 0-based第36/30帧；约870.9677/725.8065ms，与旧逻辑同刻 |
| 判定 | 总前伸320、宽26；同一次起手快照锁定方向和目标 |
| 待机衔接 | 原待机与新姿势在0—3、57—60帧固定脚点淡入淡出；独立鞭层同权重渐显/渐隐 |
| 直接贴图RGBA | 112.0703MiB，旧为148MiB；不含mipmap、驱动和召唤依赖闭包 |

人体来源为实际豆包Seedance 2.0 Mini第4条视频。原片鞭子过长且有异常拖影，未直接采用；BiRefNet透明人体经RIFE v4.6从31关键姿势插为61帧，5个变形中间帧由原片替代，索引在manifest中。身体采用固定比例、固定平移和共同裁框，保留自然动作轨迹。鞭子是独立制作的曲线，运行时跟手并沿锁定地面方向投影，不旋转或拉伸人体。

起落衔接沿用旧`idle.png`第一格，短交叉淡化可能出现瞬时双轮廓；这不是补生成的骨骼动作。正式`idle_single.png`仅裁掉原待机表未使用画格，不重绘或放大旧待机。上下/斜向共用侧身人体，鞭层方向对应判定，未声称已经生成八方向人体动作。

## 重建与归档边界

`install-runtime.py`默认只向被忽略的 `_rebuild/` 导出人体表、单帧待机和独立鞭数据，不写游戏JSON。它读取保留的 `sheets/hybrid-body-rife.png` 与 `source-inputs/whip-v04-optimized/`，不需要重新抠图。后者是实际使用的透明原生输入，不能当缓存删除。`sheets/hybrid-body-base.png`和`producer/rife-spritesheet-interpolate.py`保留当前一次RIFE的输入与版本；若重新插帧，使用31帧、768×384、4列输入、单次模式、6列输出、`--preserve-vertical-motion`及显式`--rife`路径，再通过`--body-sheet`传入导出器。

`--apply-runtime`才写入双份游戏配置；它要求本地工头、共享控制与渲染接口均已接入。远端尚缺这些共享接口，本次只归档素材和独立鞭数据，不发布游戏接线。`runtime-config.json`与`runtime-manifest.json`记录的是本地开发版；见[发布范围](../../../docs/animation-publication-2026-08-31.md)。导出预览的JS仍是本地接入辅助脚本，不能在缺少投影模块的远端基线直接执行。

拒绝的v01-v03 MP4、旧烘焙候选、过时GIF和安装前混合备份已可恢复回收；原始提示词、失败原因及provenance保留，v04视频完整保留。详见[清理清单](cleanup-manifest.json)。历史烘焙候选不得覆盖当前独立人体表。

未运行测试或运行时验证，按约定由用户测试；未同步EXE。重点体验八方向、目标绕后、石化解除、其他强控、墙体/迷雾/视口边缘，以及死亡和离场后的鞭层清理。
