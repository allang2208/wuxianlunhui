> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：4. 武器与装备系统

## 4. 武器与装备系统

### 武器添加标准工作流（2026-07-28 定稿，新武器一律按此开展）

与怪物/地牢/墙体工作流同规格。核心：**EquipDataManager 是唯一全量数据源，其余各点按需登记，验证四件套收尾**。

#### 1. 素材管线（贴图/音效进项目前必过）
- **贴图归一**：新武器贴图一律按类归一（SKILL.md「武器动画调试基准」）——步枪类：内容宽 0.915 / 中心 (0.500, 0.543) / 画布 2048²（AKM 布局）；手枪类：内容宽 0.862 / 中心 (0.487, 0.524) / 画布 2048²（沙鹰布局）。归一后**枪口点无需手配**（BootScene 自动烘焙，见第 4 节）。
- **音效**：入 `assets/sounds/weapons/` 子目录（目录规范），路径写进配置，不在代码写死。

#### 2. 纹理注册（src/config/weapon-texture-map.js）
- `getWeaponTextureLoadList()` 加 `{ key: 'weapon_<weaponType>', path }`（BootScene 自动加载）。
- 仅当纹理键不能由 `weapon_<weaponType>` 推导时（如按 weaponId 特供贴图），在 `getWeaponTextureKey` 的 `specialMap` 加 weaponId → 键映射。
- **WEAPON_MAP 与加载列表同源**；开发面板的姿态预览自动生效。

#### 3. 数据配置（EquipDataManager 唯一全量数据源 + equipment.json 模板）
- `src/ui/equip-data-manager.js` 加武器条目（参考 G18_PISTOL_ITEM / AKM_ITEM 同族复制）：
  - 标识：`weaponId`（weaponN 顺延）、`weaponType`（同族复用，新族=新键）、`animConfigKey`/`attackKey`/`offhandAttackKey`（可双持手枪）、`canvasImageProp`（**每把枪独立**，复用别人的会双持互盖——P4040 教训）。
  - 战斗：`attack { range, knockback, attackInterval, projectileSpeed, damageType }`、`fireMode`（semiAuto/fullAuto）、`ammoConfig { max, reloadTime }`、`spreadParams`/过热（heatParams）按族。
  - 公式：`attackFormula { base, enhanceFlat, attrs: [{ key, base, perEnhance }] }`——**唯一实战公式源**（computeWeaponAttack 全链路自动生效，图鉴/强化/tooltip 委托展示）；enhanceFlat=0 合法（沙鹰/能量LMG）。
  - 贴图字段：`iconImage/dropImage/equipImage/slotImage`、`weaponAsset.image`。
- `data/equipment.json`（**双份同步 public/**）加商店/掉落模板条目——字段从 EDM 条目复制（main.js 启动合并 + `completeWeaponFields` 消费端回退会补全实例缺字段，但**模板里写错的值不会被纠正**，只补 undefined）。
- 稀有度/定价/掉落池按既有档位（参考同级武器）。

#### 4. 弹药与攻击对象（双写点）
- `src/config/gun-ammo.js` `GUN_AMMO_CAP` 加 `weaponN: { max, reloadTime }`——**与 EDM ammoConfig 双写**（消费端 `getAmmoConfig` 三级回退兜底；`max: Infinity` 合法，JSON 克隆变 null 时有回退）。
- `attackKey` 取 `WEAPON_ATTACK_CONFIG`（src/config/weapon-attack-config.js）已有键；新射击手感（冷却/弹速/弹体）= 该文件加条目，`attacks[attackKey]` 自动创建（player/index.js 遍历注册，无需改玩家代码）。
- **枪口点**：BootScene 自动烘焙贴图最右端内容点，无需手配；个别烘焙偏差用 `muzzle.manual` 覆盖（Super90 教训：别拿右缘估计当枪口）。

#### 5. 动画与贴合调参（左下开发面板）
- `public/data/weapon-anim-config.json`（仅此单份）：以同族基准武器（手枪=沙鹰 / 双手枪=AKM）为模板加 `weaponType` 条目（top/idle/walk 状态块 holdOffset、grip、idleScale/idleRotation）。
- 面板拖武器贴合手部 → 💾保存（直写 public/data + 备份）；静态姿态=每状态 holdOffset，攻击=perFrame 逐帧（新近战动作走玩家动画工作流）。
- 双手枪械注意冲刺开火=强制 walking（内置）；`isTwoHanded: true` 别漏。

#### 6. 改造/附魔/图鉴/验证
- **改造**：`data/craft-config.json` 加 `weaponN` 槽位条目（配件槽 x/y/lineTarget，参考沙鹰）；`ItemDatabase.getByWeaponId` 懒索引反查，**新武器免登记**。不配 craft 条目 = 该武器不可改造（UI 明示，合法设计）。
- **改造新效果键要过三处**（2026-07-30 Beretta 93R 落地）：①`craft-effect-registry.js` 注册（test-craft-sync 三角校验会拦未注册键）；②消费端代码（散布在 update.js 主副手+tooltip、fireMode 在 update.js 触发器+gun-ammo getFireMode）；③craft-config 写 effects。已有键覆盖绝大多数需求（shotSpreadDelta/recoilRecoveryDelta/rangeDelta/knockbackDelta/magazineDelta/reloadTimeDelta/moveSpeedPercent/damagePercent/piercingBonus/attackIntervalDelta/spreadStartDelta/redDotScope）；**模式切换类新键**：`burstMode`（N 连发，60ms 间隔排队，末发恢复标准冷却，**主副手各自独立队列**）、`fireModeOverride`（覆盖射击模式，全自动板机）、`spreadParamsOverride`（散布模板整体覆盖）。
- **附魔/强化**：通用链路，零登记（强化只影响攻击公式派生与盾防）。
- **图鉴**：ItemDatabase 自动收录，公式展示委托 buildFormulaDisplay，无需改代码。
- **验证**：JSON 双份一致（`npm test` 的 test-regressions 双份一致性+音效路径存在性检查会拦）；`npm run lint`、`npx vite build`、`node scripts/test-collider.mjs`、`node scripts/test-craft-sync.mjs`（动了 craft 配置时）；实机清单：装备/开火/换弹/双持（手枪族）/瞄准姿态/强化+1 攻击变化/图鉴公式展示。

---

#### 全自动武器添加管线 add-weapon.py（2026-08-08 首版，M416 实证）

- **入口**：`python tools/ai-gen/add-weapon.py --spec tools/ai-gen/weapon-specs/<weapon>.json <子命令>`（相对 game-dev/ 执行）
- 子命令：
  - `scaffold`：自动写 equipment.json / craft-config.json（data+public 双份同步）+ weapon-anim-config.json（克隆同族基准武器动画块）；
    生成武器深度剪影模板（`_depth_templates/<key>_sil.png`，徽章灰 130 + 武器白 255 黑底）；生成出图/视频提示词；
    合成开火/换弹/装备三音效；输出 JS 补丁锚点清单 + 自动 verify。
  - `gen-image --host <comfyui> --model <model> --seeds a,b,c [--ref-image <真实参考图>]`：批量出候选
    （默认落 `_weapon_candidates/<key>/`，定稿后清到 Y:\scratch）。**新武器必须传 `--ref-image`**
    （白底/纯色底完整侧视实拍图）：工具自动抠剪影→黑底白枪深度图→`--control-image` 锁武器大形，
    否则 FLUX 凭文字先验画会"不像真枪"（2026-08-08 M416 教训）。参考图获取走国内图搜
    （360 图搜 `image.so.com/j?q=<枪名>&pn=1&ps=40` / 必应中国 `cn.bing.com/images/async`，
    百度 acjson 被反爬）。生图模型用远程 5080 `flux2-dev-depth`（本地无 Flux2FunControlNet 节点）。
  - `process-image --raw <候选.png> [--cutout-tool auto|rmbg|make-transparent-icon|flood|none] [--no-orient] [--no-auto-level]`：
    默认自动镜像保证枪口朝右（左右极值列高判定）→ 默认自动校平枪身基线（机匣上沿中段拟合，0.8 阻尼迭代；
    **向右下斜为正角，PIL rotate(+θ) 逆时针按同符号旋转——用 -θ 会越转越歪，2026-08-08 教训**）→
    白底抠图首选 ComfyUI-RMBG 插件（`BiRefNetRMBG` 节点，模型 `BiRefNet-general` 权重放 `ComfyUI/models/RMBG/BiRefNet/`，
    可从 NAS `Y:\模型库\ComfyUI\models\BiRefNet\` 复制；插件输出 IMAGE+MASK，本地合成 RGBA）→
    按 spec.layout 归一（步枪 2048² / 内容宽 0.915 / 中心 (0.500,0.543)）→
    写 `assets/weapons/<key>-equip.png` + `assets/icons/<key>-equip.png` → 打印 bbox/aspect/连通域/朝向。
  - `gen-video --host 192.168.3.142`：MiniMax H3 展示视频（`assets/videos/<key>_showcase.mp4`；远程 5080 离线会失败，机器上线后重跑）。
  - `verify`：双份 JSON 字节一致 + 资产/音效存在性 + 改动 JS node --check。
- **M416 实证**：`weapon-specs/m416.json`（weapon21，优质 uncommon，属性/公式略低于 AKM，30 发全自动，步枪精通生效）；
  6 张候选归档 `Y:\工作\无尽轮回\scratch\weapons\m416\`；正式贴图已入库。
- **M416 贴图重做：必须用真实参考图+剪影锁形（2026-08-08 二版教训）**：
  - 首版只靠文字提示词"strongly resembling HK416"生成，FLUX 凭先验画，结果"不像真枪"
    （用户一眼看穿）。教训：**武器贴图"像不像"由真实参考图决定，不是提示词措辞**。
  - 参考图来源：open_page/维基被墙时改用**国内图搜直连**——`image.so.com/j?q=HK416&pn=1&ps=40`
    （360 图搜 JSON，字段 img/thumb）与 `cn.bing.com/images/async?q=HK416+side+view&first=0&count=40`
    （必应中国，正则抓 `murl&quot;:&quot;...` 直链）均可用；百度 `acjson` 被反爬拦（antiFlag=1）。
  - 筛选：优先"白底/纯色底+完整侧视+枪口朝右"（`ref20.jpg` 2143×834 黑枪白底=最佳）。
    白底宽图用像素统计粗筛（white%>70 且 aspect>2.4），再 GLM 逐张确认完整性与 HK416 特征
    （导轨/伸缩托/鸟笼消焰器/弹匣）。
  - **生成必须传 `--control-image`**：从参考图抠剪影→黑底白枪 1024² 深度图（对齐 spec.layout
    centerY=0.543），`comfyui-gen.py --model flux2-dev-depth --control-image <剪影>` 锁大形；
    **add-weapon.py gen-image 默认不传控制图，是"不像"的直接根因**（首版正是如此）。
  - 本地 127.0.0.1 无 `Flux2FunControlNetLoader` 节点，远程 5080 有；`flux2-dev-depth` 走远程。
  - **方向判定坑**：`orient_right` 的左右条带高度法误判过 seed27（GLM 说右、脚本判 LEFT 并翻转→
    入库变左）。修复：`process-image --no-orient` 保留参考图原始方向，像素仲裁（右端细=枪管）确认。
  - 参考图与剪影已归档 `Y:\工作\无尽轮回\scratch\weapons\m416\ref_*`，候选
    `m416_icon_refgen_seed27.png`（GLM 9 分，朝右，已入库 2048²）。
- **武器装备音效：触发链路与 shotgun 分支捆绑是坑（2026-08-08 M416 补录）**：
  - 症状：M416 的 `equipSound` 已配置且 wav 存在，但装备/切换时不响。
  - 根因：装备音效播放代码**只写在 `weaponType==='shotgun'` 分支里**（super90 注释
    "装备Super90时播放枪栓音效"），rifle/lmg 分支只换贴图不发声——配置有、触发无。
  - 修复：把 `getEquipSound(item)` + `SoundManager.playFile` 从 shotgun 分支**提升到
    武器槽处理块末尾**（subsystems.js switchWeaponMode 与 equip-manager.js
    equipFromBackpack 两处），对任意配置了 equipSound 的枪统一生效；无配置的枪
    （如 AKM）自然静音。运行时打桩验证：切回 M416 播 m416_equip.wav、AKM 不播。
  - 音效内容：参考射击游戏"拉机柄上膛"——中频金属滑动(0~0.16s) + 拉机柄到位清脆
    咔哒(0.16s) + 枪机闭锁低频金属撞击(0.27s) + 击锤/弹匣锁定余响(0.42s)，0.62s
    立体声 WAV（44.1kHz）。模板见 add-weapon.py 的 synth_equip（可按需替换）。
  - 教训：**新增武器"有配置≠有触发"**，音效/特效/逻辑都要沿触发链路查一遍，
    不能只看数据层；找同族基准（super90）的代码位置直接抄结构。

#### 标准全自动添加枪械武器工作流（2026-08-08 M416 全流程定稿）

按序执行，每步可单独跑、可断点续传：

1. **写 spec**：`tools/ai-gen/weapon-specs/<key>.json`。字段模板抄 `m416.json`：
   weaponId 顺延（weaponN）、name/rarity/price、statsJson + attackFormula（略低于同族基准）、
   attack/ammoConfig（弹容/换弹/三种音效路径）、fireMode、spreadParams、craftTemplateWeaponId、
   animTemplateWeaponType（同族基准）、layout（2048²/0.915/centerY 0.543）、imagePrompts.icon/video。
2. **scaffold**：`python tools/ai-gen/add-weapon.py --spec ... scaffold` → 自动写
   equipment.json/craft-config.json（data+public 双份）、weapon-anim-config.json、深度剪影模板、
   出图/视频提示词、三音效（开火/换弹/装备），并输出 JS 补丁锚点清单。
3. **搜真实参考图（国内直连）**：360 图搜 `image.so.com/j?q=<枪名>+侧视&pn=1&ps=40` 或
   必应中国 `cn.bing.com/images/async`，优先"白底+完整侧视+枪口朝右"实拍图；
   GLM-4.6V 逐张确认完整性与枪型特征。参考图归档 `Y:\工作\无尽轮回\scratch\weapons\<key>\ref_*`。
4. **生图（必须带参考图）**：`gen-image --model flux2-dev-depth --host 192.168.3.142
   --ref-image <参考图> --seeds a,b,c`（自动抠剪影锁形）；GLM 验收候选（完整侧视/枪型/白底/无缺陷），
   定稿候选归档同目录。
5. **处理入库**：`process-image --raw <候选> --cutout-tool rmbg --no-orient`（参考图朝右时
   **必须 --no-orient**，避免 orient_right 误判翻转；用像素仲裁方向：右端细=枪管）。BiRefNet 抠图 →
   校平 → 2048² 归一 → 写 assets/weapons + assets/icons。
6. **JS 补丁**：按 scaffold 锚点清单用 apply_patch 落盘（EDM/shop/player-defaults/weapon-texture-map/
   weapon-attack-config/gun-ammo/craft-default-slots/weapon-fx-config/attack-formula/weapon-anim/update/
   subsystems/GameScene/weapon-transform/enchant-config/quick-bar/equip-manager/attack/game/dev-tool/
   defense-system）。**音效触发已通用化**（getEquipSound 非空即播），新枪只需在
   `GUN_EQUIP_SOUND` 或 spec.equipSound 配置路径，无需改 shotgun 分支。
7. **验证**：`verify`（JSON 双份一致 + 资产/音效存在 + JS node --check）+ `npm run lint` +
   CDP 实机（装备/切枪/开火/改造面板）+ 像素统计（bbox/aspect/连通域/朝右）。
8. **沉淀**：SKILL.md 武器段追加本条经验（参考图来源/剪影锁形/方向坑/触发链路坑）。

#### .357麦格农左轮实证（weapon22，2026-08-08 第二轮，手枪族）

- **手枪族关键设定**：weaponType 复用 `'pistol'`（双持/副手/手枪精通/attack.js 等全部
  逻辑自动覆盖），但 attackKey/offhandAttackKey/animConfigKey/canvasImageProp 每把枪独立
  （`revolver`/`revolverOffhand`/`revolver`/`revolverImage`）——避免双持互盖（P4040 教训）。
- **JS 补丁清单（手枪族，按 deagle 基准）**：EDM 加 ITEM（含 equipSound/ammoConfig/reloadSound）、
  shop-system 加条目、player-defaults images 加 key、player/index.js 预载 `revolverImage`、
  weapon-texture-map specialMap weapon22 + 加载列表、weapon-attack-config 加 `revolver`+`revolverOffhand`
  两攻击块、weapon-transform 加 `revolver` 变换块 + **getWeaponSize/getAttackAnimOffset 的手枪判定
  三处加 'revolver'**（wt=animConfigKey 会落默认 rifle 尺寸，必须显式加）、GameScene 五处
  isGun/isGunR/isGunOff/isGunSpecial 加 'revolver'、subsystems/equip-manager 的 canvasImageProp
  分支加 `revolverImage`（否则误映射 pistolImage）、gun-ammo GUN_AMMO_CAP + GUN_EQUIP_SOUND、
  craft-default-slots 复制同族槽位、game.js 掉落列表、dev-tool/panels、attack.js 开火音效
  **改为通用 `fireWeapon.fireSound` 优先**（新枪专属开火音自动生效，无需逐枪 else-if）。
- **auto-level 对左轮不可靠**：圆形转轮 + 下垂握把导致上沿拟合法 8 次迭代不收敛（越转越歪）。
  修复：`--no-orient` 后手动迭代——GLM 定性判断方向（偏高/偏低），用枪管段（右端细长部分）
  中心线拟合做像素仲裁（±1° 内可接受）。枪口朝右基准：右端细=枪管。
- **参考图**：S&W 左轮白底侧视（Britannica）→ 归档 `Y:\工作\无尽轮回\scratch\weapons\revolver357\`；
  gen-image 用 `--ref-image` 自动剪影锁形，4 张候选 seed27 定稿（GLM 9 分）。
- **音效**：开火 = .357 重击+金属回音（0.42s）；换弹 = 转轮甩出→6 发装填→合上→锁定（2.0s）；
  装备 = 拔枪+转轮锁定双咔哒（0.55s）。三种均 44.1kHz 立体声。
- **验证**：verify 全过（双份 JSON/资产/音效/node --check）+ lint 0 error + npm test 全绿 +
  CDP 实机（EDM 物品/改造 6 槽/纹理注册 `weapon_revolver357`/攻击表 revolver+revolverOffhand/
  装备音效触发/掉落列表）。
- **"机线严格水平向右"专项（2026-08-08 用户验收）**：
  - 用户强调枪身/枪口/整条机线必须严格水平向右。验收方法：**像素仲裁为准**，
    GLM 目测只做方向与"偏高/偏低"定性（度数不可靠，SKILL 既有结论）。
  - 测量窗口坑：左轮含圆形转轮+下垂握把+枪口收窄，选区不同结果差异大（center 可从
    -0.4° 到 +8°）。**必须取纯枪管段**（右端 25%~45% 宽度、列高<主体 55%、排除最前准星 30px）
    拟合中心线；整体 bbox 中心线拟合会被握把带偏（-14° 假象）。
  - 校正迭代：先逆时针转 2~3° 看方向，再按中心线余角微调（0.85° 级），目标 ±0.5° 内；
    **PIL rotate(+θ)=逆时针**（向右下斜=右端低→逆时针抬右端）。每轮旋转后重测纯枪管段。
  - 抠图白边：旋转 expand 用黑填充+BICUBIC 会留黑边/白羽化。修复链：压白底→BiRefNet 重抠→
    清"邻域有低 alpha 的近白像素"（仅外圈，保留枪身内部高光——不锈钢反光近白 6 万是正常材质）→
    alpha 形态学腐蚀 1px 剥最外圈。验收：过渡带(alpha 8~250)亮色占比 <1% 即干净。
  - 用户验收口径：枪口朝右（右端细=枪管）、枪管中心线水平、转轮清晰、无白边。
- **左轮音效与单发装填（2026-08-08 用户验收二轮）**：
  - 开火音效用户嫌"小声不脆"→ 重做：低频冲击(70Hz,×1.0)+主爆裂(250-4000Hz,×1.1)+
    尖锐高频 snap(2-9kHz,×0.95) 叠加，峰值拉满到 0.98。**合成音效要"响亮"就把峰值
    归一化到 0.9+ 并叠高频层**，别留安全余量。
  - 换弹改**一发一发装填**（参考 Super90）：`ammoConfig.singleReloadMode: true` +
    `reloadTime: 900`（每发 900ms）。未满弹期间 `state.reloading=true` 自动阻止开火，
    无需额外逻辑。改三处配置：EDM / shop-system / gun-ammo 回退表。
  - **单发装填音效坑**：`_updateReload` 继续装填分支硬编码
    `Super90-reload.mp3`、满弹分支硬编码 `bolt_pull_1s_clean.wav`——新枪会播错音。
    修复：优先读 `ammoConfig.reloadSound`（每发）与新增 `reloadFinishSound`（满弹收尾），
    缺失再回退旧值。**改通用机制时必须检查硬编码回退，否则同族武器全串音**。
  - 左轮四音效：开火 0.5s（重击+脆响）/ 每发装填 0.35s 金属咔哒 /
    最后一发+转轮回摆合上 1.0s / 装备拔枪+转轮锁定 0.6s。
- **音效链路去硬编码（2026-08-08 专项）**：
  - 原则：**所有枪械音效路径配置化（fireSound/reloadSound/reloadFinishSound/equipSound），
    攻击/换弹代码零逐枪硬编码**；新枪只在数据层配字段，无需改逻辑。
  - `GUN_FIRE_SOUND` 回退表（gun-ammo.js，weaponType/animConfigKey → 默认开火音）：
    attack.js 开火统一 `getFireSound(item)`——实例 fireSound 优先，缺失按
    animConfigKey→weaponType 查表兜底（**先 animConfigKey 再 weaponType**：
    左轮 weaponType 复用 pistol，若只按 weaponType 会查到 G18 的音）。
  - 换弹：普通武器一次性装填改 `reloadSound || reload_sharp.mp3`；单发装填每发
    读 `reloadSound`、满弹读 `reloadFinishSound`（旧代码硬编码 Super90-reload.mp3 /
    bolt_pull 会串音，2026-08-08 已修）。
  - 过热音：`heatParams.overheatSound` 可选配置，缺失回退类型硬编码（PKM/能量机枪）。
  - 保留项：GameScene isGun/isGunR/isGunOff/isGunSpecial 数组差异有语义
    （isGunR/Special 不含 beretta93r），不改；add-weapon 锚点清单已提醒新枪同步。
- **真实音效抓取：B 站音频流方案（2026-08-08，合成音效不理想后启用）**：
  - 搜索：`api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=<关键词>`
    （需 Referer: bilibili.com + UA）。选"自制音效/实拍录制"类视频，标题描述能确认内容。
  - 取流：`view?bvid=` 拿 cid → `x/player/playurl?bvid=&cid=&fnval=16` 拿 DASH 音频
    （选 bandwidth 最高的 audio，baseUrl 直接下载 m4s，需带 Referer）。
  - 解码：无 ffmpeg 时 `pip install av`（PyAV 自带 FFmpeg），m4s 是标准 MP4 容器。
  - 截取：波形 RMS 找事件（10ms 块），单发枪声=孤立短促尖峰+衰减尾音；
    **连射视频前段常有连续峰值，要选中间孤立的单发**（M500 视频 9.30s 处 peak 0.216 最干净）。
    归一化峰值 0.9 保证响亮。合成音效"小声"根因是留了安全余量，真实录音归一化即可。
  - 案例：左轮四音效替换为 B 站真实录音（fire=M500 真枪单发 0.44s；reload=金属咔哒 0.15s；
    reload_last=装填+转轮合上+闭锁 0.55s；equip=转轮甩出 0.16s）。旧合成版留 `.synthbak`。
  - 兼容：44.1kHz 16-bit 单声道 WAV，浏览器 Audio 直接播。

#### 枪械改造全面审计（2026-08-08 首轮，13 把枪械）

- **方法**：craft-config.json 全量导出 → CRAFT_EFFECT_REGISTRY 校验效果键 → 同族
  横向对比 → 消费端（subsystems/combatant）模拟改造后数值。
- **结论一（最严重）**：步枪族 `light_mag` = `magazineDelta:-30`，对 30 发弹匣
  （AKM/M416/QBZ-191）装后 maxAmmo=0→钳到 1，**枪废**。PKM(75→45)/QJB(60→30)
  尚可。修复：-30 应改按百分比（如 -40%）或按弹容比例（30 发枪 -8、75 发枪 -30）。
- **结论二**：左轮改造=沙鹰逐字复制（含 extended_mag +2→8 发弹巢，违背左轮固定
  弹巢设定；单发装填无 fastReload 专属配件）。手枪族应差异化：左轮加
  speed_loader（fastReload）、cylinder_lighten（reloadTimeDelta）、magnum_round
  （伤害/击退）等。
- **结论三**：QBZ-191/QJB-201 muzzle 数值与 AKM/PKM/M416 不同族（suppressor
  -200 vs -300、flash_hider 隐藏火光 vs +射程）——功能差异应有描述支撑，
  否则为复制时手改残留。
- **结论四**：全部枪械 sight 只有 red_dot/russian_3x 两件；高稀有度枪
  （epic）无专属改造（沙鹰/左轮/P4040 无弹种深度改造）。建议 epic 加
  1-2 件机制级配件（P4040 的 auto_trigger 是范本）。
- **审计工具沉淀**：一次性脚本思路——效果键合法性用正则提取 registry 键对比；
  数值失衡用"基础数据×改造叠加"模拟；同族一致性用 options 全量 diff。
- **枪械改造审计落地（2026-08-08 首轮修复）**：
  - light_mag 弹匣 -30 改为百分比：新增 `magazinePercent` 效果键（multiply，
    消费端 subsystems/combatant 均 `maxAmmo = round(maxAmmo * (1 + pct))`），
    light_mag = -40%（30 发→18、75→45、60→36，不再废枪）。
  - 左轮专属改造：9发弹仓（magazineDelta:3）、快速装弹器（fastReload，单发装填
    每次装 2 发 → 6 发装 3 次≈原 3 发时间）、麦格农高压弹（伤害+10%击退+15）、
    平头铅弹（穿透+1）、甩锤速射（攻速-250ms 散布+2°）、重型枪口配重、
    麦格农补偿器。图标复用现有 craft 图标（缺图用 fmj/muzzle_brake/light_trigger
    等代替）。
  - QBZ-191/QJB-201 muzzle 残留 bug：suppressor -200/隐藏火光/缺 spreadStartDelta，
    统一为 AKM 同族标准（suppressor -300 击退+5、flash_hider +150 射程 -10°、
    muzzle_brake 双 500ms）。
  - 沙鹰加机制件：double_tap_trigger（burstMode:2 + 散布+1°），epic 手枪机制差异化。
  - 教训：**弹容量改造必须按比例或分档，固定值-30 会废掉 30 发弹匣枪**；
    **同族 muzzle 复制后手改会残留不一致**，加武器后用 options diff 校验。
- **枪械专属独特改造批量落地（2026-08-08 二轮，12 把枪 +42 件）**：
  - 新效果键 3 个：`moveSpreadPercent`（移动散布倍率，消费端 combatant.getSpreadInfo
    按 this.isMoving 乘算 maxAngle）、`stationarySpreadPercent`（静止散布倍率，同处）、
    `overheatRecoverPercent`（过热恢复百分比，消费端 update.js 两处 recoverTime 乘算）。
    注意 multiply 模式聚合仍是加和，百分比乘算必须在消费端手动应用。
  - 每把枪专属件（机制差异化而非数值堆叠）：AKM 木托/侧折叠/7.62重弹；M416 HK托/
    活塞调校/导轨；QBZ 无托平衡/高速扳机/光瞄；PKM 弹链箱/快换枪管/两脚架；
    QJB 弹鼓/散热管/持续火力托；能量机枪 过载电池/散热鳍/聚焦透镜；沙鹰 .50重弹/
    比赛枪管/重型机匣；G18 弹鼓/三连发/内置消音；P4040 穿甲弹/激光/快拔；
    Beretta 双发点射/加长握把/制退器；Super90 加长弹管/重鹿弹/弹壳快挂；
    SAIGA 竞赛扳机/独头弹精调/战术灯；左轮 镜座/强化击锤簧/轻量弹巢。
  - 图标复用：新件 icon 映射到现有 craft 图标（fmj/muzzle_brake/light_trigger/
    burst_trigger/carbon_fiber_mag/drum_mag 等），无需生成新图。
  - 验证：三份 JSON hash 一致、聚合逻辑运行时确认 3 新键生效、测试全绿。

#### 可组合高稀有机枪机制合同（2026-08-27）

- **独立二选一组**：同一机制维度内二选一，跨维度允许完整组合；强收益通过射速、散布、弹匣、换弹、射程或机动代价显式平衡，不用隐藏互斥或共享预算暗中削减组合收益。
- **弹射与追加结算**：主弹命中回调只负责启动一次机制；每条弹射分支携带独立的已访问目标集合与明确次数上限，余震、星图线伤、天顶坠击、符文裁决等追加伤害直接进入伤害管线，不重新挂载主弹回调。防无限循环应限制事件来源和递归代数，而不是禁止合理组合。
- **玩家/塔载同源**：神话与传说机枪的命中机制必须由共享处理器统一目标过滤、视线、伤害和特效；玩家状态按武器实例保存，防御塔按塔实例保存。序列机制要有停火超时、失活目标清理和对象池回调重置，避免跨战斗或跨弹丸继承陈旧状态。

- **分工约定**：本工具只写 JSON 数据（bulk rewrite）+ 生成二进制资产；JS 源码按 scaffold 输出的锚点清单用 apply_patch 落盘
  （EDM / shop / gun-ammo / craft-default-slots / weapon-texture-map / weapon-attack-config / weapon-fx-config /
  attack-formula / weapon-anim / update / subsystems / game.js / dev-tool / defense-system）。
- **新武器逻辑分支全量对账（2026-08-08 M416 教训）**：数据层加完后必须 `rg "akm" src -g "*.js"`（或用同族基准武器名）
  全量对账逻辑分支，逐处补同族 weaponType，否则典型症状=无法开枪/持枪贴图错误。已知必查清单：
  `subsystems.js`（isPkmOrAkm 开火执行、主/副手 cfgKey、_isPkmOrAkm 动画）、`update.js`（isPkm 全自动组、attackKey 三元链）、
  `GameScene.js`（isGun/isGunR/isGunOff/isGunSpecial/副手名单 六处）、`weapon-transform.js`（每类型变换块 + getAttackAnimOffset 分支）、
  `weapon-anim.js`（远程判定/cfgKey）、`equip-manager.js`（equippedRangedType）、`defense-system.js`（塔装载/伤害/高度）、
  `enchant-config.js`（可附魔武器类型）、`quick-bar.js`（冲撞/远程判定）、`weapon-fx-config.js`（lmg.soundMap）。

---

### 枪械无法开火排查手册（开枪链路全断点地图，2026-07-26 定稿）

开不了火的原因太多太散，一律按本手册走：**先跑诊断脚本定位断点段，再按段查已知案例**，不要凭直觉改代码。

#### 一、开火链路四段（断点必在其中一段）

```
① 输入闸门（player/update.js 各武器分支）
   hasAmmo && !isReloading && weaponSwitchCooldown<=0 && fireTrigger
   && attacks[attackKey].canUse() && stamina>=COST
   → 设置 rangedFireData + triggerWeaponAnim()
② 状态机（weapon-anim.js updateWeaponAnim）
   triggerWeaponAnim → state='swing' → swing 分支调 _fireRanged('main')
   （卡死保护：非 idle 超 5s 强制回 idle）
③ 发射（subsystems.js _fireRanged）
   消耗弹药 → 枪口坐标 → ProjectileFactory.create + 枪口火光 + 弹壳 + 音效
④ 枪口定位（_getMuzzleWorldPosition）
   读 scene.weaponSprite 的 x/y/rotation/displayWidth，
   sprite 不可见则回退脚底相对算法（子弹从脚射出的根因区）
```

#### 二、断点案例索引（历史上全部"无法开火"根因）

| 断点段 | 案例 | 根因 | 修复 |
|---|---|---|---|
| ② | v1.9 远程无法开枪 | `triggerAttackAnimation` 未调 `_fireRanged` | 补调用 |
| ① | v1.11 全枪械无法开火 | equipment.json 缺 `ammoConfig/fireMode/attackFormula/attackKey` | main.js 启动合并 EquipDataManager 字段 |
| ④ | v2.8 地牢子弹从脚射出 | 地图模式 `weaponSprite.setActive(false)` 后未恢复，枪口回退脚底算法 | 非地图模式统一 `setActive(true)`（共享链路） |
| ① | 2026-07-26 AKM 无法开枪 | 实例经未合并旁路获得、缺 `ammoConfig`，`_initAmmoForSlot` 无回退 → 弹药状态 null | 改用 `getAmmoConfig(item)` 按 weaponId 回退 |
| ④ | v2.7 遗留：复活后子弹不从枪口射出 | 未复现，待场景线索 | — |

#### 三、①号段六闸门逐项排查（最常见断点区）

- `_hasAmmo(slot)` false：弹药状态 null（缺 ammoConfig，见上表）或打空中（`current<=0`）。
- `_isReloading(slot)` 卡 true：换弹计时器卡死会精确导致"无法开枪"，第二嫌疑位。
- `weaponSwitchCooldown > 0`：切枪冷却未走完。
- `fireTrigger`：半自动读 `leftPressed`、全自动读 `leftDown`，别混。
- `attacks[attackKey].canUse()` false：冷却卡住；`attackKey` 缺字段时有 `|| 'pistol'` 兜底。
- `stamina < CONFIG.STAMINA_RANGED_COST`：体力不足静默拦截。
- 近战专属输入锁：`weaponAnim.state === 'attacking'` 时忽略左键（只影响近战，不误伤枪）。

#### 四、即用诊断脚本（控制台两段式）

**第 1 段·状态快照**（哪个 null/false 哪个就是断点）：
```js
(() => {
  const p = Game.player, slot = p.weaponMode, item = p.equipments[slot];
  console.log('①武器:', item?.name, '| type:', item?.weaponType, '| attackKey:', item?.attackKey, '| fireMode:', item?.fireMode);
  console.log('②弹药:', JSON.stringify(p._getAmmoState?.(slot)), '| 换弹中:', p._isReloading?.(slot));
  console.log('③状态机:', JSON.stringify(p.weaponAnim), '| rangedFired:', p.rangedFired);
  console.log('④切换CD:', p.weaponSwitchCooldown, '| 体力:', p.data?.stamina);
  const k = item?.attackKey || 'pistol';
  console.log('⑤攻击对象:', k, !!p.attacks[k], '| canUse:', p.attacks[k]?.canUse?.());
})();
```

**第 2 段·强制触发**（绕过①直接打②③，区分"输入条件拦截"还是"链路断"）：
```js
const p = Game.player;
p.rangedFireData = { targetX: p.x + 300, targetY: p.y, entities: [...Game.entities.values()], mainSlot: p.weaponMode, fireMainHand: true };
p.triggerWeaponAnim();
setTimeout(() => console.log('触发后:', JSON.stringify(p.weaponAnim), '| rangedFired:', p.rangedFired), 600);
```
判读：`rangedFired: true` = 链路完好、断点在①六闸门；`false` 或报错 = 断点在②③，看控制台红错。

#### 五、修复原则
- 断点修在**共享链路**上（原则10），主神空间/地牢全场景生效，禁止单场景补丁。
- 数据缺失用**消费端回退**兜底（见上节），不依赖启动合并单点。
- ④枪口问题先查 `weaponSprite.visible/texture` 与地图模式 active 恢复。

---

### 阶段性进度总结（2026-07-27：攻击力公式体系统一——单一公式源）

#### 核心规则（防再犯）
1. **唯一实战公式**：`src/config/attack-formula.js` 的 `computeWeaponAttack`（经 `Player.getCurrentWeaponAtk`）——战斗/面板/强化预测全部同链，**禁止**新建第二套武器伤害公式；`weapon-damage-formulas.js`（硬编码死代码）已删除。
2. **唯一全量数据源**：`EquipDataManager`（src/ui/equip-data-manager.js）——新武器在这里配 `attackFormula` 即全链路生效；实例缺字段经 `completeWeaponFields`（main.js 启动合并 / shop-system 商品列表共用）或 `getAttackFormula` 的 EDM 查找层自动补全，不要在新数据源里复制字段清单。
3. **getAttackFormula 三级回退**：item.attackFormula → EDM 查找（weaponId/name，含嵌套下钻）→ stats"物理攻击"正则兜底（base 取下限，可能偏离设计值，仅兜底）。
4. **展示公式唯一实现**：`buildFormulaDisplay`（数值版）/ `buildEnhancedFormulaDisplay`（符号版），图鉴/强化面板/tooltip 全部委托。
5. **强化链**：只影响攻击（公式派生）与盾防（base+perEnhance×级）；射速/弹夹/换弹无强化公式；enhanceFlat=0 是合法设计（沙鹰/能量LMG）。
6. **教训**：`equip-tooltip-manager` 曾调用不存在的方法 `getItemByName`（实际 `getEquipByName`）导致图鉴合并静默失效——调用对象方法前先确认存在；商店/掉落/存档多源物品必须过统一补全层。

---

### 主副手与施法媒介契约（2026-08-24）

- `weapon/weapon2` 是两套可切换的**主手武器组**；`offhand/ring2` 是与其配对的副手支援槽。单手武器不等于可放副手，所有拖拽、双击、商店与旧存档迁移统一委托 `equip-rules.js::canEquipSlot()`，禁止各入口复制类型判断。
- 副手白名单目前只有 `shield | spellbook | magic_book`；枪械、法杖和普通近战武器都不能进入副手。未来魔法书沿 `bonusStats`/专属效果扩展，不复制法杖的 `matkFormula`，避免主副手双法杖叠成长。
- 法杖施法媒介只认 `player.weaponMode` 对应的当前主手。魔攻公式、制作词条、施法动画和中高级魔法门槛都不得读取未激活武器组或副手。
- 切换主手后必须立即 `calculateCombatStats()`；旧存档物品经 `completeWeaponFields()` 回填权威字段。规则迁移若卸下非法副手，要先尝试背包，背包已满再安全掉落，不能静默覆盖或丢失。

---

### 装备/道具图标统一处理工作流（2026-08-02 定稿：装备图标放大 + 视觉居中沉淀）

新增装备/道具图标（`iconImage` 类贴图）一律按此处理，保证与武器图标观感一致。

#### 1. 判定标准（先量化，别靠肉眼）
- UI 图标显示尺寸由 CSS 固定（`object-fit: contain` 的 44px 等盒子），**PNG 画布像素大小不影响观感**——决定观感的是「内容占画布比例」和「内容是否视觉居中」。
- 与武器图标对齐的实测基准：武器内容包围盒占画布 **86%~98%**（最长边）；装备此前只有 12%~60%，且 **alpha 加权质量中心**偏离画布中心最高 ±400px（壁垒重盔 x=-393、魔力腰带 x=-374、壁垒重靴 x=+279）。
- 量化方法（pngjs 扫 alpha>8）：内容包围盒宽高占比 + 质心偏移。目标：**最长边 ≈90%、质心偏移 = (0,0)**。

#### 1.5 抠图（AI 生图一律先抠底，2026-08-03 定稿：本地 BiRefNet 透明抠图）
- **抠图统一入口（2026-08-08 定稿，强制）：ComfyUI-RMBG 插件 BiRefNet-general**——
  `tools/ai-gen/rmbg_cutout.py`（`get_model()` / `predict_alpha(model, pil)`）是唯一抠图入口，
  rebuild-h3-birefnet / single-idle-prep / 后续新增工具一律走它。模型缓存
  `ComfyUI/models/RMBG/BiRefNet`（离线，check_model_cache 验证），不再用 transformers
  直载 MS-BiRefNet（birefnet-cutout.py 仅留作兼容）。运行环境必须 ComfyUI venv。
- **背景色强制（2026-08-08 定稿）：生图/视频背景必须用主体没有的颜色**——提示词由
  `pick_bg_color.py` 选色注入：`pick_bg_color_from_image(参考图)` 自动从 CANDIDATES
  选与主体色板距离最远的纯色（视频管线 `minimax-h3-gen.py --bg-color auto`），
  或 `--bg-color #RRGGBB` 显式指定；注入函数 `inject_background` 同时写死
  "无阴影/无光源/无投影"条款。**抠图侧必须同色**：`rebuild --bg-color` 使阈值兜底/
  腿部兜底/去污染/边缘清理全部按"与背景色的距离"自适应（白底兼容，--bg-dist 默认 20）。
  纯色底 + 距离阈值一刀切 + BiRefNet 边缘，是"抠得干净"的标准组合。
- **为什么不用颜色阈值抠图**：SDXL 的"pure white background"实际是浅灰渐变 + 暗角
  （角部像素 140~200 灰），且主体贴边时边界采样会把主体误判为背景（2026-08-03 实测：
  分块背景模型把贴边的镇岳重甲抠成 42×59 碎片；固定近白阈值则整图残留灰底）。
  BiRefNet 是显著性分割模型，不吃背景色假设，边缘毛刺/半透明也稳。
- **生图提示词仍必须写"主体完全在画面内、四周留白"**，否则细长物品（腰带等）延伸到
  画面外被裁切，即使 BiRefNet 也只能抠出残缺主体（2026-08-03 不息腰带两连坑：
  金属徽章误生成、皮带横穿出界被裁；改为"盘绕成圈、完整居中"后通过）。
- 抠图完成后必须验证：`tools/ai-gen/edge-check-*.py` 扫 alpha∈(10,245) 的边缘像素，
  **白色占比应为 0%**（>0.5% 即白边残留，需重抠或重生成）；另跑
  `tools/ai-gen/verify-eclipse-icons.py` 确认 1536² / 内容 90% / 纵横比 ∈[0.72,1.4] / 居中。

#### 1.6 装备构图硬性规则（2026-08-03 定稿，AI 提示词必须遵守）
- **靴子/鞋类只生成一只、朝右**：提示词写 `a single right-facing boot, one boot only facing
  right, no pair`；SDXL 常无视 "right-facing" 仍生成朝左，兜底方案是出图后
  `tools/ai-gen/flip-boots-right.py` 水平镜像（单只靴子镜像无左右脚问题）。
  判定用 GLM-4.6V 逐张问"鞋头指向左还是右"。
- **盔甲类要写全下半身**：仅写 "chest piece" 会得到只有胸口的残件，必须写
  `full torso armor from shoulders down to hips, abdominal plates, waist belt,
  faulds (segmented skirt armor), tassets`，并让 GLM 确认"是否有下半身/裙甲"。
- **禁止多余装饰元素**：蚀月套曾反复出现"圆环/光环/圆形徽章"（法帽后方、法袍胸口、
  长靴上方）——negative 必须加 `circular halo, circular frame, circular emblem,
  circular ornament, floating circle, glowing circle behind object,
  ring-shaped decoration around the object, ornamental circle, magic circle`
  （注意不要用裸词 `ring`，会误伤戒指类装备）。

#### 2. 处理步骤（一段式 pngjs 脚本）
1. 画布规格：**1536×1536 透明底**（与现有装备图标一致；画布尺寸本身不重要，改动不影响代码）。
2. 裁剪：内容包围盒（alpha>8）。
3. **纵横比归一化（2026-08-02 增补，解决"扁平/细长条看起来小"）**：内容纵横比限制在 **[0.72, 1.4]**——宽扁条（>1.4）沿长轴裁剪到 1.4、细长条（<0.72）沿长轴裁剪到 0.72，裁剪窗口**以视觉重心（质心）为中心**（保住主体/扣件/坠子，裁掉细长尾/链端）；方形图标框（object-fit contain）里所有图标可见尺寸趋于一致。
4. 放大：双线性缩放到最长边 = 画布×0.90（对齐武器 86%~95%）。
5. 居中：**内容包围盒平移到画布中心**（与武器图标同口径——轮廓居中即可；图形本体固有重心偏移属素材构图，不为它缩图/裁切）。
6. 合成回透明画布，覆盖写原文件。

#### 3. 验证清单
- 最长边占比 = 0.90；纵横比 ∈ [0.72, 1.4]；包围盒中心偏移 ≤1px；尺寸仍 1536×1536；dev server 加载 200 image/png。
- dev server 加载 200 image/png；商店/装备栏/图鉴实机目检与武器同档。

#### 4. 关键点/坑
- **不要按 alpha 加权质心居中**（2026-08-02 实测教训）：魔力腰带/壁垒重盔等素材固有构图偏重，质心居中会把它推到画布一侧甚至被迫缩图（0.60~0.75），观感反而更差——**统一按内容包围盒居中 + 0.90 硬性大小**，与武器图标一致。
- 大小硬性 0.90：最长边 = 画布×0.90，不缩图、不裁切。
- 只统一最长边不够：宽扁条（魔力腰带 2.34:1）在方形图标框里仍只有其他腰带的一半高——**必须做纵横比归一化**（上限 1.4），否则"大小一致"只停留在文件层、观感仍不一致（2026-08-02 实测教训）。
- 图标全链路共用 `iconImage` 字段（装备栏 `slotImage || iconImage`、掉落、图鉴、商店）——改贴图即全局生效，无需改代码。
- 源文件此前保留在 `E:\无尽轮回\游戏\素材库\装备`（原始大图；⚠ 该路径已废弃，
  素材库现约定为 NAS `Y:\素材库\`）；游戏内使用 `assets/icons/equipment/` 的处理后副本；脚本按本流程用 pngjs 现写（临时脚本不入库）。

---

### 装备/首饰添加标准工作流（2026-08-03 定稿，稀有套装入库首航）

新防具/首饰（非武器）一律按此开展。与武器工作流同规格：**equipment.json 双份是唯一数据源**，
图标/掉落/图鉴/商店全链路共用 `iconImage` 字段，改数据即全局生效。

#### 1. 数据（data/equipment.json + public/data/equipment.json 双份）
防具条目结构：
```json
{ "name", "type", "icon", "category": "armor", "rarity": "rare", "level": 10,
  "equipSlot": "helmet|armor|boots", "armorSet": "flowing|eclipse|zhenyue",
  "armorSetSlot": "helmet|armor|boots",
  "defense": { "base": 8, "perEnhance": 2 },
  "bonusStats": { "wis": 2 }, "bonusPerEnhance": { "wis": 1.5 },
  "stats": [{ "name": "物理防御", "value": "+8", "pos": true }],
  "desc", "iconImage": "assets/icons/equipment/xxx.png" }
```
首饰条目：`category: "accessory"`、无 defense/armorSet，`bonusStats/bonusPerEnhance`
为六维或 atk/matk/crit/maxHp/maxMp/maxStamina（tooltip 的 attrNames 决定显示名）。
新增条目脚本：`tools/ai-gen/add-eclipse-set-to-equipment.py`（幂等，双份同步，改完跑
`tools/verify-set-shop.mjs` 确认双份一致 + 图标文件存在 + 商店目录齐全——⚠ 该校验脚本已丢失、待重建）。

#### 2. 套装键（base.js 三件套判定）
- `calculateCombatStats` 中 `setCount` 按 helmet/armor/boots 同 `armorSet` 计数，
  新键照抄 light/robe/heavy 分支（移速乘子 / `_cooldownReduction` / `_magicDamageBonus`）。
- 稀有三套定稿：`flowing`（移速+15%、体力恢复+12%）、`eclipse`（冷却-18%、魔伤+25%）、
  `zhenyue`（40% 格挡 85%、移速-12%）。
- 体力恢复加成：`updateMaxStats` 里 `_staminaRegenMul` 乘 1.12（装备/祭品倍率之后）。
- 格挡类套装键：`damageable-entity.js` takeDamage 分支按 `_armorSetActive` 区分
  壁垒（30%×80%）与镇岳（40%×85%），统一 `blockCfg { chance, remain }` 结构。

#### 3. tooltip（equip-tooltip-manager.js）
`setNames` / `setBonuses` 两个 map 同步补新套装键（防具/首饰分支按 category 命中）。

#### 4. 商店（shop-system.js SHOP_CATALOGS.blacksmith）
- blacksmith 目录 = ItemDatabase 装备 id 字符串数组，运行时懒解析（`_equipFromDatabase`），
  缺 price 按稀有度标准价兜底（rare=400）。新装备加 id 即上架，无需完整商品对象。
- 掉落：`chest-room-system.js _equipmentPool()` 自动含全部 armor/accessory（ItemDatabase 数据源），
  新增装备零登记自动进精英宝箱房掉落池。

#### 5. 验证四件套
- `tools/verify-set-shop.mjs`（双份一致/图标存在/商店目录/套装件数=3；⚠ 脚本已丢失、待重建，重建前以 JSON 双份比对 + 实机目检代替）
- JSON 双份一致（test-regressions 会拦）；`npm run lint`；`npx vite build`；
  `node scripts/test-config-integrity.mjs`；实机：商店购买 → 装备三件 → 面板套装生效
  （移速/冷却/魔伤/格挡）→ tooltip 套装文案。

#### 6. 本次教训（2026-08-03 蚀月/流云/镇岳套首航）
- 数值取整：稀有 = 优质 ×1.25 后**向上取整**（12.5→13），成长保留 0.5 步进；
  属性点取整（1.25→2），保证"不低于 25%"。
- 细长物品（法袍/项链）纵横比裁剪后 alpha 边缘收缩会让 ar 略低于 0.72（0.685），
  强裁会砍下摆——保留原状并在交付说明，不做无谓二次裁剪。
- 用户视角的"没调整/超出边界"常是**新图标与原图撞设计**（心形吊坠撞车）或水印误伤，
  用 GLM 对比新旧图 + 像素边界量化（`tools/check-margins.py`）定位，别只看单文件。

#### 7. 史诗套首航（2026-08-06 星穹 stellar，输出向）
#### 7. 史诗三套（2026-08-06 星穹/苍月/天罡，轻/法/重齐备）
- **体系对齐**：装备分轻甲/法袍/重甲三系，史诗档必须三套齐备（用户提醒），
  与优质三套（疾风/秘法/壁垒）→ 稀有三套（流云/蚀月/镇岳）的递推链一致。
- **数值递推**：史诗 = 稀有 ×1.25 向上取整（基础值取整、成长取整到 0.5 步进）：
  - 星穹（轻甲，稀有流云上位）：盔 8+2→10+2.5、甲 13+2.5→17+3.5、靴 5+1.5→7+2
  - 苍月（法袍，稀有蚀月上位）：盔 7+1.5→9+2(wis 2+1.5→3+2)、袍 9+1.5→12+2(int 同)、靴 4+1.5→5+2
  - 天罡（重甲，稀有镇岳上位）：盔 30+2.5→38+3.5(maxHp 19+6.5→24+8.5)、甲 43+4→54+5、靴 15+2.5→19+3.5
- **套装效果**（base.js 三个分支 + damageable-entity 格挡）：
  - stellar：暴击率+15%、物攻+10%（`_critSetBonus`/`_physicalDamageBonus` 新字段）、移速+8%
  - lunar：冷却-22%、魔伤+30%（复用 `_cooldownReduction`/`_magicDamageBonus`）
  - tiangang：格挡 50%×90%（blockCfg 新分支）、移速-10%
- **配套首饰**：仅星穹配 3 件（项链 str+dex / 戒指 atk / 腰带 maxHp，稀有首饰 ×1.25）；
  苍月/天罡纯三件套（与稀有套无配套首饰的模式一致）。
- **图标**：`flux2-klein-4b-equipment` LoRA 生成（星穹深蓝金辉/苍月月银蓝光/天罡暗铁金纹），
  GLM 6+6 全过 → BiRefNet 抠图 → 1536² 最长边 0.90 居中，细长件保留 aspect。
- **接线**：equipment.json 双份 12 件 + base.js 3 分支 + tooltip 3 键 +
  shop blacksmith 12 id（epic 兜底 800）；验证四件套同 §5。

---

### 祭品添加标准工作流（新增祭品一律按此开展）

#### 1. 数据结构（data/equipment.json，双份同步 public/）
祭品物品：`{ name, type: '祭品', icon, category: 'tribute', rarity, level, stack, price, effects: {...}, stats: [{name, value}], desc, special?: {...} }`
- `effects` 为固定百分比数值（负数为减益），引擎最终乘算 `Π(1+p/100)`；`stats` 仅用于面板显示；`special` 为特效参数块（非百分比语义）。
- 不写贴图时用 emoji 图标。
- 献祭后统一持续30分钟，并在主神空间、世界和地牢中连续倒计时；同一稀有度同时只能生效一件，新祭品覆盖旧的同级效果并从30分钟重新计时。
- `anchorTokenF~A` 虽为兼容代币合成保留 `category:'tribute'`，但语义是地牢钥匙；必须由 `isDungeonKeyItem()` 排除在献祭池外。

#### 2. 效果键（config/tribute-effects.js 聚合）
- 面板向：atkPercent/matkPercent/defPercent/mdefPercent/moveSpeedPercent/critPercent（calculateCombatStats 末尾乘算）
- 经济向：goldPercent/expPercent/dropChancePercent
- 恢复向：hpRegenPercent/mpRegenPercent/staminaRegenPercent（倍率）
- 怪物向：monsterDamageTakenPercent（承伤）/monsterAtkDownPercent（攻击削减）/monsterMoveSlowPercent（移速削减）
- 比例向（**耦合规则**）：combatChanceDelta（百分点，战斗↑事件↓或反向，**战斗+随机事件恒=100%，一个调整同步影响另一个**）/eliteChanceDelta（精英概率百分点）
- 特效键：revivePercent（蟠桃复活）/killMpHealPercent（人参回蓝）/expPercent（雪莲经验）
- 友方向（2026-08-22 工艺品祭品，全体友方单位=friendlyUnits+PartySystem 侍从）：friendlyAtkPercent（Companion.getPhysicalAttackDamagePreview 乘算）/friendlyMaxHpPercent（updateMaxStats 乘算，祭品变动由 refreshFriendlyTributeStats 刷新）/friendlyMoveSpeedPercent（MovementSystem._getEnemyBaseSpeed 友军分支）/visionRangePercent（VisionSourceRegistry.radiusOf）
- 特效键（2026-08-22）：friendlyLifestealPercent（全体友方吸血，damageable-entity 扣血点结算）/friendlyAuraRadius+friendlyAuraMoveSpeedPercent（玩家为中心光环，移速乘区同点消费）/recruitCountMul（producer-building spawnUnit 递归倍增，_noRecruitMul 防递归）/productionResourcePercent（银行/风车产出，前台 population-economy-system 与后台 world122-sim 双份乘算）

#### 3. 数值带（按属性稀缺度）
| 类别 | 普通 | 优质 | 稀有 | 史诗 | 神话 | 传说 |
|---|---|---|---|---|---|---|
| 标准带（攻防/金币/体力/事件比/怪物向） | 1~2 | 3~4 | 5~6 | 7~8 | 9~10 | 11~15 |
| 珍贵带（移速/暴击/怪物减速） | 1 | 2 | 3 | 4 | 5 | 7 |
| 廉价带（生命/魔法恢复） | 4 | 8 | 12 | 18 | 22 | 30 |
- 普通/优质/稀有 = 1 增益 + 1 减益（按物品特性）；史诗及以上 = 纯增益；负效果取对应带低档。
- 神话/传说必须带特效词条（item.special + SPECIAL_BUFFS 图标）。

#### 4. 特效模式（参考实现）
- surviveCapPercent：单次伤害上限（玩家 takeDamage 拦截）
- moonshadowDuration/moonshadowDamagePercent：进战斗无敌+精英/Boss 增伤（战斗入口 _triggerMoonshadow）
- oreUpgrade：拾取祭品品质+1，传说额外给一件（tryPickupItem 转换）
- revivePercent：死亡 3s 原地复活一次
- killMpHealPercent：击杀后 1s 回蓝（计时器+buff）
- 特效参数放 item.special，不上 effects 聚合；buff 栏走 syncTributeBuffs/clearTributeBuffs。

#### 5. 掉率表（combat-formulas.json tributes.dropTables）
elite（必掉）/normal（5%）两表按稀有度权重；新增等级自动按 RARITY_ORDER 参与。

#### 6. 验证
JSON 双份一致；lint / vite build / test-collider / test-craft-sync；CHANGELOG 记录。

- v3.5 (2026-07-18) — 20 矿石祭品/怪物向效果/比例耦合/三新特效
  - 引擎扩展：怪物向三键（承伤/攻击削减/移速削减）、比例耦合键（combatChanceDelta 战斗事件恒 100% 同步）、eliteChanceDelta、dropChancePercent、staminaRegenPercent
  - 20 矿石祭品（数值带按稀缺度三档：珍贵/标准/廉价）；磁铁矿战斗+6pp事件-6pp、星光蓝宝事件+8pp战斗-8pp（耦合实现）
  - 三新特效：金刚石「金刚不坏」（单次伤害≤15%最大生命）、月光石「月影」（入战无敌 15s+精英/Boss 物魔伤+5%）、贤者之石「点石成金」（拾取祭品品质+1，传说额外给一件随机传说）
  - 祭品添加标准工作流归档（本节）

- v3.6 (2026-07-19) — 祭坛/合成/旧祭品迁移/定价
  - 祭坛 NPC（小鼠大王下方实心圆）：献祭出征/祭品合成/退出三选项；合成 2 低→1 高随机池，传说祭品重随一件；不同稀有度拒绝（提示栏）；一键放入按稀有度筛选（仅背包，不调仓库）；奇数合成剩「最后添加/名称序最后」一件；合成槽 20、堆叠整组拖放
  - 三旧祭品（麦穗/石头/大理石）迁移数据驱动 effects，删除全部按名硬编码；初始背包映射走 ItemDatabase；祭品 maxStack 999、出征栏同名限制；全祭品按稀有度统一定价 100/200/400/800/1600/3200

- v3.7 (2026-07-19) — 附魔等级体系替换为稀有度体系
  - enchant-config.js 卷轴 `grade` 字段用 common~legendary（原 F/E/D 等字母级废弃）；显示一律 RARITY_LABELS；魔法粉尘消耗/分解产出随稀有度档调整

- v3.8 (2026-07-19) — 地牢难度分级（FEDCBA）
  - `data/dungeon-config.json` dungeonList 每地牢 `grade` 字段（zombie=D「☠ 僵尸地牢高级」、zombieBeginner=F「☠ 僵尸地牢-初级」；内部键不动，仅显示名）
  - 祭品掉落按难度分表：combat-formulas.json `tributes.dropTables` 以 F~A 为键，每级 `maxRarity` 封顶（F≤稀有、E≤史诗、D+≤传说）+ elite/boss（必掉）/normal（几率掉，F 2% 起每级 +0.5%）三张权重表；`rollTributeDrop(rank, dungeonType)` 查表
  - 骑士冲锋期间 `noCollision` 无视实体碰撞（可穿人不可穿墙），结束由分离系统墙解析挤出，防卡死/瞬移

- v3.9 (2026-07-19) — 随机事件分级体系
  - 事件两段判定（dungeon-event-system rollEventType）：先 30% 通用 / 70% 限定，再组内按权重抽
  - 限定池：`RESTRICTED_EVENT_META`（dungeon-event-definitions.js）每事件 `{ grade, scope }`——scope=地牢大类（现全部 zombie），grade=事件等级，仅出现「地牢等级 ±1」内的事件
  - 通用事件（女神像/恶魔雕像/宝箱/陷阱/补给堆）奖励分级：`combat-formulas.json universalEventRewards` 按地牢 grade 覆盖（祝福场次/粉尘/金币/恢复量等），陷阱/补给属性检定成功率每级 -2pp 下调（下限沿用 minSuccessRate）；宝箱 D 级起 10% 祭品彩蛋走 rollTributeDrop
  - 改名「僵尸地牢」→「僵尸地牢高级」全界面同步

- v4.0 (2026-07-19，已由 v4.1 替换) — 旧祭品准入方案
  - “携带对应稀有度祭品才能进地牢”及 `_getRequiredRarity()` 已废止，不得恢复 `_carriedItems` 或出征祭品槽。

- v4.1 (2026-08-22) — 地牢钥匙准入
  - F~A 地牢严格对应 `anchorTokenF~A`；确认出征自动检测背包与仓库，优先背包、其次仓库消耗1枚对应钥匙，不接受更高等级钥匙替代。
  - 出征面板不再挂载祭品填充栏、祭品效果栏或右侧背包；左侧条件栏显示当前钥匙名称和背包+仓库总持有量。
  - 时空锚点仍允许同稀有度代币合成，但不能进入位面祭坛献祭列表。
  - **样式坑**：根 `game-style.css` 才是 index.html 加载的全局样式表；`src/ui/` 下新建 css 无任何引用会成为孤儿文件，全局样式一律追加到根 game-style.css
  - 修复 `getTributeHpRegenFlat` 缺失导出（引用先于实现，vite build 报 Missing export——引用配置函数前先确认导出存在）

---

