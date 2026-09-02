# 近代非炮兵三单位最小正式归档

本目录归档反坦克步枪兵、近代侦察步枪兵和钢盾突击兵在运行时接入前已经获准的最小可重建链。它不是新的生成批次，也不替代四个MiniMax单位的独立正式包：

- 四个MiniMax单位：`tools/ai-gen/_industrial_four_units_20260902/`
- 对应获准母图和源视频：`tools/ai-gen/_industrial_shooting_mothers_20260831/`、`tools/ai-gen/_industrial_cavalry_mothers_20260831/`
- 本目录三单位：`units/anti_tank_rifleman/`、`units/industrial_recon_rifleman/`、`units/steel_shield_assault/`

每个单位只保留获准母图与直接祖先、实际方向参考、获准源视频及供应方JSON、提示词、未插帧源表、最终运行时钟GIF/联系图、正式构建报告和重建脚本。逐帧抠图缓存、被判退视频二进制和重复制作预览不进入Git；判退原因和生成元数据仍保留在`source-review.json`及各生成记录中。

运行时正式PNG位于`assets/companions/`，双份帧布局与事件帧位于`data/`和`public/data/`。本目录只证明来源和离线制作链，不证明游戏实机通过。

## 收口状态（2026-09-02）

- 反坦克步枪兵：待机、跑动、枪击、投弹和死亡共5动作；投弹最终图集第45帧脱手。
- 近代侦察步枪兵：待机、跑动、单发拉栓攻击和死亡共4动作；攻击最终图集0-based第22帧开火。
- 钢盾突击兵：待机、跑动、单发手枪攻击和死亡共4动作；攻击正式时长约1500ms。
- 三者均已完成静态运行接入；近代炮兵不在本归档范围。
- 未运行测试、构建、浏览器/CDP、游戏运行时验证或EXE发布。
