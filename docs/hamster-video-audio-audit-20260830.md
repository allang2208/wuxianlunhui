# 仓鼠兵种逐视频音效处理清单 · 2026-08-30

共登记 **103段** 视频：43段待机/死亡按要求排除，其余60段逐项处理。**18个现有兵种接入33段音效**；另4段炮兵素材提取暂存，未新增尚未上线的兵种。

## 接入结果

- 狙击手、突击兵、重机枪、反载具兵冲锋枪、特种兵、防暴队、侦察游骑兵使用各自视频枪声；连发取单发，站定/移动开火分开配置。
- 剑士、戟兵、方阵、骑兵、翼骑兵、长弓手、爆矛骑兵使用对应攻击声；爆矛助推与命中爆炸分开触发。
- 忍者开场/连击/烟遁分开接线；连击视频混有鼓点，改用同兵种旧版干净刀声的两个随机变体，不更换动画。
- 投石车现用v02实质静音，仅借用同兵种v01发射声，对齐当前离勺事件。
- 可用脚步低音量单次播放，仅实际移动时触发；无常驻循环，无待机/死亡接线。
- 反载具兵火箭、弩手攻击等混音不直接入库；大主教施法的持续和声/吟唱待确认，保留原圣光声。
- 野战炮/榴弹炮4段位于tools/ai-gen/_hamster_audio_staged_20260830，未注册运行时兵种。

## 方法与交付边界

使用[MIT AST AudioSet模型](https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593)在本地分析全片及2秒滑窗，再结合频谱、响度和裁剪窗口视频动作。没有人工试听；模型分数不是无BGM保证，节律脚步也可能被识别为鼓点，未只凭阈值决定导入。现存原视频、原音效均保留；投石车与榴弹炮各有 1 段 v01 攻击源视频已不在当前归档中，清单已明确标注并保留裁剪窗口及成品音效。

未运行测试或运行时验证，按约定由用户测试。重点试听大量部队脚步音量、枪声单发节奏、忍者变体、爆矛助推/爆炸及投石车离勺同步。未修改伤害、射速、动画或生产规则。

## 文件与复现

- [裁剪清单](../tools/ai-gen/hamster-action-audio-20260830.json)：来源、时间窗口、事件键。
- [逐视频审核数据](../tools/ai-gen/hamster-video-audio-audit-20260830.json)：完整识别依据及逐项结论。
- [提取脚本](../tools/ai-gen/extract-hamster-action-audio-20260830.py)：用项目ComfyUI Python执行，加 --extract。44.1kHz立体声160kbps MP3，去直流、12ms淡入淡出、RMS/峰值限制。
- 配置：[hamster_heavy_machine_gunner](../data/hamster-heavy-machine-gunner-config.json)、[hamster_anti_vehicle](../data/hamster-anti-vehicle-config.json)、[hamster_ninja](../data/hamster-ninja-config.json)、[hamster_sniper](../data/hamster-sniper-config.json)、[hamster_assault](../data/hamster-assault-config.json)、[hamster_special_forces](../data/hamster-special-forces-config.json)、[hamster_riot_squad](../data/hamster-riot-squad-config.json)、[hamster_scout_rifle_skirmisher](../data/hamster-scout-rifle-skirmisher-config.json)、[hamster_champion](../data/hamster-champion-config.json)、[hamster_halberdier](../data/hamster-halberdier-config.json)、[hamster_phalanx](../data/hamster-phalanx-config.json)、[hamster_cavalry](../data/hamster-cavalry-config.json)、[hamster_winged_hussar](../data/hamster-winged-hussar-config.json)、[hamster_longbow](../data/hamster-longbow-config.json)、[hamster_powered_eod_explosive_lancer](../data/hamster-powered-eod-explosive-lancer-config.json)、[hamster_catapult_crew](../data/hamster-catapult-crew-config.json)、[hamster_archbishop](../data/hamster-archbishop-config.json)、[hamster_crossbow](../data/hamster-crossbow-config.json)；已有public/data镜像同步，data/audio-config.json增加枪声预载。
- 接线：hamster-scout-ai、hamster-musketeer-ai、hamster-ninja-ai、hamster-knight-ai、hamster-catapult-crew-ai；脚步为friendly-movement-sound及7个实体基类。
- 未发现独立源视频的旧兵种保留原声音，不声称它们已被重新提取。游侠攻击任务登记为本地关键帧动画，没有攻击源视频。

## 逐视频结果

| # | 视频 | 结论 | 窗口 / 原因 |
|---|---|---|---|
| 1 | [_hamster_anti_vehicle_20260826/h3/videos/hamster_anti_vehicle_dying_h3.mp4](../tools/ai-gen/_hamster_anti_vehicle_20260826/h3/videos/hamster_anti_vehicle_dying_h3.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 2 | [_hamster_anti_vehicle_20260826/h3/videos/hamster_anti_vehicle_idle_h3.mp4](../tools/ai-gen/_hamster_anti_vehicle_20260826/h3/videos/hamster_anti_vehicle_idle_h3.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 3 | [_hamster_anti_vehicle_20260826/h3/videos/hamster_anti_vehicle_rocket_attacking_h3_v02.mp4](../tools/ai-gen/_hamster_anti_vehicle_20260826/h3/videos/hamster_anti_vehicle_rocket_attacking_h3_v02.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 4 | [_hamster_anti_vehicle_20260826/h3/videos/hamster_anti_vehicle_running_h3.mp4](../tools/ai-gen/_hamster_anti_vehicle_20260826/h3/videos/hamster_anti_vehicle_running_h3.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 5 | [_hamster_anti_vehicle_20260826/h3/videos/hamster_anti_vehicle_smg_attacking_h3.mp4](../tools/ai-gen/_hamster_anti_vehicle_20260826/h3/videos/hamster_anti_vehicle_smg_attacking_h3.mp4) | 已接入 | attack 2.47–3.7s |
| 6 | [_hamster_archbishop_doubao_20260828/videos/dying-doubao-v01.mp4](../tools/ai-gen/_hamster_archbishop_doubao_20260828/videos/dying-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 7 | [_hamster_archbishop_doubao_20260828/videos/idle-doubao-v01.mp4](../tools/ai-gen/_hamster_archbishop_doubao_20260828/videos/idle-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 8 | [_hamster_archbishop_doubao_20260828/videos/moving-doubao-v01.mp4](../tools/ai-gen/_hamster_archbishop_doubao_20260828/videos/moving-doubao-v01.mp4) | 已接入 | walk 0.56–0.85s |
| 9 | [_hamster_archbishop_doubao_20260828/videos/spellcast-doubao-v01.mp4](../tools/ai-gen/_hamster_archbishop_doubao_20260828/videos/spellcast-doubao-v01.mp4) | 和声/吟唱待确认 | 持续和声/吟唱，不能确认不是配乐；保留原圣光声 |
| 10 | [_hamster_assault_20260827/videos/attacking-doubao-v01.mp4](../tools/ai-gen/_hamster_assault_20260827/videos/attacking-doubao-v01.mp4) | 已接入 | attack 3.06–4.05s |
| 11 | [_hamster_assault_20260827/videos/dying-doubao-v01.mp4](../tools/ai-gen/_hamster_assault_20260827/videos/dying-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 12 | [_hamster_assault_20260827/videos/idle-doubao-v01.mp4](../tools/ai-gen/_hamster_assault_20260827/videos/idle-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 13 | [_hamster_assault_20260827/videos/running-doubao-v01.mp4](../tools/ai-gen/_hamster_assault_20260827/videos/running-doubao-v01.mp4) | 已接入 | walk 0.37–0.75s |
| 14 | [_hamster_catapult_animations_20260830/videos/attack-v01.mp4](../tools/ai-gen/_hamster_catapult_animations_20260830/videos/attack-v01.mp4) | 已接入 | attack 1.85–3.24s |
| 15 | [_hamster_catapult_animations_20260830/videos/attack-v02.mp4](../tools/ai-gen/_hamster_catapult_animations_20260830/videos/attack-v02.mp4) | 实质静音 | 全片约-97dBFS，近乎静音；借用同兵种v01发射声 |
| 16 | [_hamster_catapult_animations_20260830/videos/die-v01.mp4](../tools/ai-gen/_hamster_catapult_animations_20260830/videos/die-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 17 | [_hamster_catapult_animations_20260830/videos/idle-v01.mp4](../tools/ai-gen/_hamster_catapult_animations_20260830/videos/idle-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 18 | [_hamster_catapult_animations_20260830/videos/run-v01.mp4](../tools/ai-gen/_hamster_catapult_animations_20260830/videos/run-v01.mp4) | 已接入 | walk 0.26–0.76s |
| 19 | [_hamster_cavalry_pair_20260827/videos/cavalry/attacking-doubao-v01.mp4](../tools/ai-gen/_hamster_cavalry_pair_20260827/videos/cavalry/attacking-doubao-v01.mp4) | 已接入 | attack 2.29–2.97s |
| 20 | [_hamster_cavalry_pair_20260827/videos/cavalry/dying-doubao-v01.mp4](../tools/ai-gen/_hamster_cavalry_pair_20260827/videos/cavalry/dying-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 21 | [_hamster_cavalry_pair_20260827/videos/cavalry/idle-doubao-v01.mp4](../tools/ai-gen/_hamster_cavalry_pair_20260827/videos/cavalry/idle-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 22 | [_hamster_cavalry_pair_20260827/videos/cavalry/running-doubao-v01.mp4](../tools/ai-gen/_hamster_cavalry_pair_20260827/videos/cavalry/running-doubao-v01.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 23 | [_hamster_cavalry_pair_20260827/videos/winged_hussar/attacking-doubao-v01.mp4](../tools/ai-gen/_hamster_cavalry_pair_20260827/videos/winged_hussar/attacking-doubao-v01.mp4) | 已接入 | attack 1.13–1.92s |
| 24 | [_hamster_cavalry_pair_20260827/videos/winged_hussar/dying-doubao-v01.mp4](../tools/ai-gen/_hamster_cavalry_pair_20260827/videos/winged_hussar/dying-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 25 | [_hamster_cavalry_pair_20260827/videos/winged_hussar/idle-doubao-v01.mp4](../tools/ai-gen/_hamster_cavalry_pair_20260827/videos/winged_hussar/idle-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 26 | [_hamster_cavalry_pair_20260827/videos/winged_hussar/running-doubao-v01.mp4](../tools/ai-gen/_hamster_cavalry_pair_20260827/videos/winged_hussar/running-doubao-v01.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 27 | [_hamster_champion_20260826/videos/attacking-doubao-v02.mp4](../tools/ai-gen/_hamster_champion_20260826/videos/attacking-doubao-v02.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 28 | [_hamster_champion_20260826/videos/attacking-doubao-v03.mp4](../tools/ai-gen/_hamster_champion_20260826/videos/attacking-doubao-v03.mp4) | 已接入 | attack 1.91–2.66s |
| 29 | [_hamster_champion_20260826/videos/attacking-doubao.mp4](../tools/ai-gen/_hamster_champion_20260826/videos/attacking-doubao.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 30 | [_hamster_champion_20260826/videos/dying-doubao.mp4](../tools/ai-gen/_hamster_champion_20260826/videos/dying-doubao.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 31 | [_hamster_champion_20260826/videos/idle-doubao.mp4](../tools/ai-gen/_hamster_champion_20260826/videos/idle-doubao.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 32 | [_hamster_champion_20260826/videos/running-doubao-v02.mp4](../tools/ai-gen/_hamster_champion_20260826/videos/running-doubao-v02.mp4) | 已接入 | walk 0.67–1.06s |
| 33 | [_hamster_champion_20260826/videos/running-doubao.mp4](../tools/ai-gen/_hamster_champion_20260826/videos/running-doubao.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 34 | [_hamster_crossbow_20260827/videos/attacking-doubao-v01.mp4](../tools/ai-gen/_hamster_crossbow_20260827/videos/attacking-doubao-v01.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 35 | [_hamster_crossbow_20260827/videos/dying-doubao-v01.mp4](../tools/ai-gen/_hamster_crossbow_20260827/videos/dying-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 36 | [_hamster_crossbow_20260827/videos/idle-doubao-v01.mp4](../tools/ai-gen/_hamster_crossbow_20260827/videos/idle-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 37 | [_hamster_crossbow_20260827/videos/idle-doubao-v02-loop.mp4](../tools/ai-gen/_hamster_crossbow_20260827/videos/idle-doubao-v02-loop.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 38 | [_hamster_crossbow_20260827/videos/idle-doubao-v02.mp4](../tools/ai-gen/_hamster_crossbow_20260827/videos/idle-doubao-v02.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 39 | [_hamster_crossbow_20260827/videos/moving-doubao-v01-loop.mp4](../tools/ai-gen/_hamster_crossbow_20260827/videos/moving-doubao-v01-loop.mp4) | 无音轨 | 派生视频无音轨；同动作原始视频另行审核 |
| 40 | [_hamster_crossbow_20260827/videos/moving-doubao-v01-restricted-fix.mp4](../tools/ai-gen/_hamster_crossbow_20260827/videos/moving-doubao-v01-restricted-fix.mp4) | 无音轨 | 派生视频无音轨；同动作原始视频另行审核 |
| 41 | [_hamster_crossbow_20260827/videos/moving-doubao-v01.mp4](../tools/ai-gen/_hamster_crossbow_20260827/videos/moving-doubao-v01.mp4) | 已接入 | walk 0.11–0.56s |
| 42 | [_hamster_crossbow_20260827/videos/moving-doubao-v02-restricted-fix.mp4](../tools/ai-gen/_hamster_crossbow_20260827/videos/moving-doubao-v02-restricted-fix.mp4) | 无音轨 | 派生视频无音轨；同动作原始视频另行审核 |
| 43 | [_hamster_crossbow_20260827/videos/moving-doubao-v02.mp4](../tools/ai-gen/_hamster_crossbow_20260827/videos/moving-doubao-v02.mp4) | 已接入 | walk 0.56–1.02s |
| 44 | [_hamster_field_cannon_animations_20260830/videos/attack-v01.mp4](../tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/attack-v01.mp4) | 提取暂存 | attack 2.28–5.17s |
| 45 | [_hamster_field_cannon_animations_20260830/videos/die-v01.mp4](../tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/die-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 46 | [_hamster_field_cannon_animations_20260830/videos/idle-v01.mp4](../tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/idle-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 47 | [_hamster_field_cannon_animations_20260830/videos/run-v01.mp4](../tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/run-v01.mp4) | 提取暂存 | walk 0.14–1.3s |
| 48 | [_hamster_halberd_20260825/videos/attacking-doubao.mp4](../tools/ai-gen/_hamster_halberd_20260825/videos/attacking-doubao.mp4) | 已接入 | attack 2.57–3.53s |
| 49 | [_hamster_halberd_20260825/videos/dying-doubao.mp4](../tools/ai-gen/_hamster_halberd_20260825/videos/dying-doubao.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 50 | [_hamster_halberd_20260825/videos/idle-doubao.mp4](../tools/ai-gen/_hamster_halberd_20260825/videos/idle-doubao.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 51 | [_hamster_halberd_20260825/videos/running-doubao.mp4](../tools/ai-gen/_hamster_halberd_20260825/videos/running-doubao.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 52 | [_hamster_heavy_machine_gunner_20260827/videos/attacking-doubao-v01.mp4](../tools/ai-gen/_hamster_heavy_machine_gunner_20260827/videos/attacking-doubao-v01.mp4) | 已接入 | attack 3.23–3.96s |
| 53 | [_hamster_heavy_machine_gunner_20260827/videos/dying-doubao-v01.mp4](../tools/ai-gen/_hamster_heavy_machine_gunner_20260827/videos/dying-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 54 | [_hamster_heavy_machine_gunner_20260827/videos/idle-doubao-v01.mp4](../tools/ai-gen/_hamster_heavy_machine_gunner_20260827/videos/idle-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 55 | [_hamster_heavy_machine_gunner_20260827/videos/running-doubao-v01.mp4](../tools/ai-gen/_hamster_heavy_machine_gunner_20260827/videos/running-doubao-v01.mp4) | 已接入 | walk 0.79–1.04s |
| 56 | [_hamster_howitzer_animations_20260830/videos/attack-v01.mp4](../tools/ai-gen/_hamster_howitzer_animations_20260830/videos/attack-v01.mp4) | 提取暂存 | attack 2.62–5.17s |
| 57 | [_hamster_howitzer_animations_20260830/videos/die-v01.mp4](../tools/ai-gen/_hamster_howitzer_animations_20260830/videos/die-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 58 | [_hamster_howitzer_animations_20260830/videos/run-v01.mp4](../tools/ai-gen/_hamster_howitzer_animations_20260830/videos/run-v01.mp4) | 提取暂存 | walk 0.3–4.75s |
| 59 | [_hamster_longbow_20260827/videos/attacking-doubao-v01.mp4](../tools/ai-gen/_hamster_longbow_20260827/videos/attacking-doubao-v01.mp4) | 已接入 | attack 3.6–4.16s |
| 60 | [_hamster_longbow_20260827/videos/dying-doubao-v01.mp4](../tools/ai-gen/_hamster_longbow_20260827/videos/dying-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 61 | [_hamster_longbow_20260827/videos/idle-doubao-v01.mp4](../tools/ai-gen/_hamster_longbow_20260827/videos/idle-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 62 | [_hamster_longbow_20260827/videos/moving-doubao-v01.mp4](../tools/ai-gen/_hamster_longbow_20260827/videos/moving-doubao-v01.mp4) | 已接入 | walk 0.2–0.88s |
| 63 | [_hamster_ninja_20260826/videos/attacking-doubao-v03-wide.mp4](../tools/ai-gen/_hamster_ninja_20260826/videos/attacking-doubao-v03-wide.mp4) | 已接入 | attackContinuous 3.42–4.17s |
| 64 | [_hamster_ninja_20260826/videos/attacking-doubao-v04-ultrawide.mp4](../tools/ai-gen/_hamster_ninja_20260826/videos/attacking-doubao-v04-ultrawide.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 65 | [_hamster_ninja_20260826/videos/attacking-doubao-v05-centered.mp4](../tools/ai-gen/_hamster_ninja_20260826/videos/attacking-doubao-v05-centered.mp4) | 已接入 | attack 0.92–1.98s |
| 66 | [_hamster_ninja_20260826/videos/attacking-doubao.mp4](../tools/ai-gen/_hamster_ninja_20260826/videos/attacking-doubao.mp4) | 已接入 | attackContinuous 2.19–2.88s |
| 67 | [_hamster_ninja_20260826/videos/continuous-attacking-doubao-v04-centered.mp4](../tools/ai-gen/_hamster_ninja_20260826/videos/continuous-attacking-doubao-v04-centered.mp4) | 音乐/鼓点，不接入 | 刀击叠有低频鼓点；连击改用同兵种干净旧版刀声 |
| 68 | [_hamster_ninja_20260826/videos/continuous-attacking-doubao.mp4](../tools/ai-gen/_hamster_ninja_20260826/videos/continuous-attacking-doubao.mp4) | 音乐/鼓点，不接入 | 刀击叠有低频鼓点；连击改用同兵种干净旧版刀声 |
| 69 | [_hamster_ninja_20260826/videos/dying-doubao.mp4](../tools/ai-gen/_hamster_ninja_20260826/videos/dying-doubao.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 70 | [_hamster_ninja_20260826/videos/idle-doubao.mp4](../tools/ai-gen/_hamster_ninja_20260826/videos/idle-doubao.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 71 | [_hamster_ninja_20260826/videos/running-doubao.mp4](../tools/ai-gen/_hamster_ninja_20260826/videos/running-doubao.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 72 | [_hamster_ninja_20260826/videos/smoke-bomb-doubao-v02.mp4](../tools/ai-gen/_hamster_ninja_20260826/videos/smoke-bomb-doubao-v02.mp4) | 已接入 | stealth 2.72–3.24s |
| 73 | [_hamster_ninja_20260826/videos/smoke-bomb-doubao.mp4](../tools/ai-gen/_hamster_ninja_20260826/videos/smoke-bomb-doubao.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 74 | [_hamster_phalanx_20260826/videos/hamster_phalanx_attacking_h3.mp4](../tools/ai-gen/_hamster_phalanx_20260826/videos/hamster_phalanx_attacking_h3.mp4) | 已接入 | attack 1.05–1.7s |
| 75 | [_hamster_phalanx_20260826/videos/hamster_phalanx_dying_h3.mp4](../tools/ai-gen/_hamster_phalanx_20260826/videos/hamster_phalanx_dying_h3.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 76 | [_hamster_phalanx_20260826/videos/hamster_phalanx_idle_h3.mp4](../tools/ai-gen/_hamster_phalanx_20260826/videos/hamster_phalanx_idle_h3.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 77 | [_hamster_phalanx_20260826/videos/hamster_phalanx_walking_h3_v02.mp4](../tools/ai-gen/_hamster_phalanx_20260826/videos/hamster_phalanx_walking_h3_v02.mp4) | 已接入 | walk 0.84–1.6s |
| 78 | [_hamster_powered_eod_explosive_lancer_20260827/videos/charge-attacking-doubao-v01.mp4](../tools/ai-gen/_hamster_powered_eod_explosive_lancer_20260827/videos/charge-attacking-doubao-v01.mp4) | 已接入 | chargeStart 1.96–2.78s；chargeImpact 2.97–4.8s |
| 79 | [_hamster_powered_eod_explosive_lancer_20260827/videos/dying-doubao-v01.mp4](../tools/ai-gen/_hamster_powered_eod_explosive_lancer_20260827/videos/dying-doubao-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 80 | [_hamster_powered_eod_explosive_lancer_20260827/videos/idle-h3-v02.mp4](../tools/ai-gen/_hamster_powered_eod_explosive_lancer_20260827/videos/idle-h3-v02.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 81 | [_hamster_powered_eod_explosive_lancer_20260827/videos/lance-attacking-doubao-v01.mp4](../tools/ai-gen/_hamster_powered_eod_explosive_lancer_20260827/videos/lance-attacking-doubao-v01.mp4) | 已接入 | attack 2.04–2.82s |
| 82 | [_hamster_powered_eod_explosive_lancer_20260827/videos/running-h3-v01.mp4](../tools/ai-gen/_hamster_powered_eod_explosive_lancer_20260827/videos/running-h3-v01.mp4) | 已接入 | walk 3.51–3.72s |
| 83 | [_hamster_ranger_20260826/videos/dying-h3.mp4](../tools/ai-gen/_hamster_ranger_20260826/videos/dying-h3.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 84 | [_hamster_ranger_20260826/videos/idle-h3.mp4](../tools/ai-gen/_hamster_ranger_20260826/videos/idle-h3.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 85 | [_hamster_ranger_20260826/videos/running-h3-v02.mp4](../tools/ai-gen/_hamster_ranger_20260826/videos/running-h3-v02.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 86 | [_hamster_riot_squad_20260826/videos/hamster_riot_squad_attacking_h3_v01.mp4](../tools/ai-gen/_hamster_riot_squad_20260826/videos/hamster_riot_squad_attacking_h3_v01.mp4) | 已接入 | attack 1.93–2.74s |
| 87 | [_hamster_riot_squad_20260826/videos/hamster_riot_squad_dying_h3_v01.mp4](../tools/ai-gen/_hamster_riot_squad_20260826/videos/hamster_riot_squad_dying_h3_v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 88 | [_hamster_riot_squad_20260826/videos/hamster_riot_squad_idle_h3_v02.mp4](../tools/ai-gen/_hamster_riot_squad_20260826/videos/hamster_riot_squad_idle_h3_v02.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 89 | [_hamster_riot_squad_20260826/videos/hamster_riot_squad_moving_h3_v04.mp4](../tools/ai-gen/_hamster_riot_squad_20260826/videos/hamster_riot_squad_moving_h3_v04.mp4) | 已接入 | walk 0.17–0.45s |
| 90 | [_hamster_scout_rifle_skirmisher_20260827/videos/attacking-doubao-v01.mp4](../tools/ai-gen/_hamster_scout_rifle_skirmisher_20260827/videos/attacking-doubao-v01.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 91 | [_hamster_scout_rifle_skirmisher_20260827/videos/dying-h3-v01.mp4](../tools/ai-gen/_hamster_scout_rifle_skirmisher_20260827/videos/dying-h3-v01.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 92 | [_hamster_scout_rifle_skirmisher_20260827/videos/idle-user-1.mp4](../tools/ai-gen/_hamster_scout_rifle_skirmisher_20260827/videos/idle-user-1.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 93 | [_hamster_scout_rifle_skirmisher_20260827/videos/moving-attacking-h3-v02.mp4](../tools/ai-gen/_hamster_scout_rifle_skirmisher_20260827/videos/moving-attacking-h3-v02.mp4) | 已接入 | movingAttack 1.89–2.56s |
| 94 | [_hamster_scout_rifle_skirmisher_20260827/videos/moving-doubao-v01.mp4](../tools/ai-gen/_hamster_scout_rifle_skirmisher_20260827/videos/moving-doubao-v01.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 95 | [_hamster_scout_rifle_skirmisher_20260827/videos/standing-attacking-h3-v03.mp4](../tools/ai-gen/_hamster_scout_rifle_skirmisher_20260827/videos/standing-attacking-h3-v03.mp4) | 已接入 | attack 2.41–3.23s |
| 96 | [_hamster_sniper_20260826/videos/attacking-doubao.mp4](../tools/ai-gen/_hamster_sniper_20260826/videos/attacking-doubao.mp4) | 已接入 | attack 2.45–3.25s |
| 97 | [_hamster_sniper_20260826/videos/dying-doubao-v07.mp4](../tools/ai-gen/_hamster_sniper_20260826/videos/dying-doubao-v07.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 98 | [_hamster_sniper_20260826/videos/idle-doubao.mp4](../tools/ai-gen/_hamster_sniper_20260826/videos/idle-doubao.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 99 | [_hamster_sniper_20260826/videos/running-h3-v02.mp4](../tools/ai-gen/_hamster_sniper_20260826/videos/running-h3-v02.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
| 100 | [_hamster_special_forces_20260826/videos/hamster_special_forces_attacking_doubao_v02.mp4](../tools/ai-gen/_hamster_special_forces_20260826/videos/hamster_special_forces_attacking_doubao_v02.mp4) | 已接入 | attack 1.64–2.73s |
| 101 | [_hamster_special_forces_20260826/videos/hamster_special_forces_dying_doubao.mp4](../tools/ai-gen/_hamster_special_forces_20260826/videos/hamster_special_forces_dying_doubao.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 102 | [_hamster_special_forces_20260826/videos/hamster_special_forces_idle_doubao.mp4](../tools/ai-gen/_hamster_special_forces_20260826/videos/hamster_special_forces_idle_doubao.mp4) | 排除待机/死亡 | 用户明确不导入待机/死亡 |
| 103 | [_hamster_special_forces_20260826/videos/hamster_special_forces_running_doubao_v02.mp4](../tools/ai-gen/_hamster_special_forces_20260826/videos/hamster_special_forces_running_doubao_v02.mp4) | 音乐/鼓点，不接入 | 音乐/节奏床与动作重叠；不直接导入混音 |
