# 盾牌开发标准工作流

适用于新增盾牌、重做盾牌视觉、增加盾牌改造，以及玩家动画状态机调整后的盾牌回归。盾牌不是只有一张装备图：基础数据、主动格挡、弹反、伤害链、体力、移动、被动格挡、改造面板和逐状态手部绑定必须作为同一个交付闭环。

## 1. 开工与范围门禁

1. 先看最近 `git log` 与 `CHANGELOG.md`，确认当前进度、并行修改和未完成边界。
2. 读根 `SKILL.md` 索引，再按任务读取 `skill/04-weapons-equipment.md`；涉及伤害/格挡时补读 `skill/05-skills-combat.md` 相关小节。生成或重做动画时另遵守动画制作前置规则。
3. 明确本轮状态：设计、候选素材、基础装备接入、改造接入、运行时验证、EXE发布。不得把前一阶段的完成描述成后一阶段完成。
4. 记录不可破坏合同：`EquipDataManager` 是装备静态真源；`data/` 与 `public/data/` 镜像同步；现有小圆盾和旧档保持兼容；普通开发不主动运行测试、构建或游戏。

## 2. 盾牌身份与基础数值

- 先确定 `weaponId`、`weaponType`、品质、等级、售价、获取池、描述、视觉轮廓和使用定位。
- 基础防御至少显式设计：`defense.base`、`defense.perEnhance`、普通格挡承伤比例、格挡体力、弹反窗口、近战弹反眩晕/击退、弹反角度和破防后果。
- 格挡减伤必须表述成“减伤比例”或“承伤比例”，文档同时给出两者，避免把 `0.42` 误读成42%减伤。
- 强化只增加本盾物防；不能顺手改变格挡比例、体力、时窗或被动概率。新增机制不得暗改碰撞尺寸、格挡角度或无敌帧。

## 3. 素材、握点与动画状态机绑定

- 新盾牌的斜视手持、外侧正面展示、内侧背面结构和装备栏物品图必须分工明确；玩家待机、防御和攻击状态中相机看到的始终是斜视母图的外盾面，背面图只用于结构、握点和背面改造语义，不得直接作为当前玩家运行纹理。斜视手持高分图登记到 `shieldVisual.guardImage`，由 `weapon-texture-map.js` 加载最长边512px运行时副本；装备栏128px图标从独立方形构图派生。生成候选与正式资产分目录，候选获批后才覆盖运行时资源。
- 每面盾牌必须有独立 `shieldVisual`：存在 `guardImage` 时，`originX/originY/defenseOriginX/defenseOriginY/visibleHeightRatio`全部以该最终斜视RGBA的画布和有效Alpha重新测量，背面握柄只提供语义投影参考，不能直接把背面像素坐标抄到外侧图。`defenseOriginX`记录盾面后的水平掌点，`defenseOriginY`记录有效Alpha上下边界的垂直中段，`defensePerspectiveScaleX`记录是否仍需兼容性水平收缩；举盾/收盾沿同一状态机进度平滑过渡两个握点轴和透视。不得复用旧小圆盾的全局 origin，也不得用屏幕坐标硬贴。
- 盾牌位置只跟随玩家副手骨链/手掌世界点。动画状态机提供肩、肘、腕与遮挡关系；盾牌只在同一掌点上应用各自图内握点和等比尺寸。
- 状态机或盾牌视觉调整后，至少逐项核对：待机、21帧普通步行、防御进入/举稳/防御步行/退出、普通攻击一二三段及回正、冲刺、冲刺突刺、手枪配盾；每项都看外侧正面是否朝向相机、左右镜像、前后遮挡、逻辑握点是否仍压在掌点、盾面是否穿胸或漂离前臂。水平 `flipX` 只能处理左右朝向，不能用于补救正背面资源选错。
- 离线骨点和预览只能说明参数链正确，不能宣称实机位置通过。正式运行时验收需用户明确授权测试，或由用户自行测试后反馈。

### 3.1 新盾牌必备资产矩阵

以后新增或完整重做盾牌时，不能只交一张正面图，也不能用同一文件硬兼任手持、装备栏和背面。每面盾牌至少完成下列四类资产；四类共同锁定同一面盾的外形、材质、纹章、边框、铆钉和磨损，背面握持结构必须能与正面铆接位置对应。

| 资产 | 固定视角与构图 | 正式用途与字段 | 尺寸及归档 |
|---|---|---|---|
| 防御斜视主母图 | 直接按本节3.2的标准生成：虚拟持盾者在画面左侧，看到外盾面；近身侧左盾缘有厚度，远身侧右盾缘收束；成图只画完整盾牌，不画人物、手臂或手 | 玩家持盾唯一外侧运行图；高分图登记 `shieldVisual.guardImage`，新盾登记 `defensePerspectiveScaleX: 1` | 真透明RGBA，母图至少1024px方形且整盾留8%—12%安全边；正式高分图放 `assets/weapons/guards/<slug>-guard.png`，由纹理管线派生最长边512px副本到 `assets/weapons/runtime/weapons/guards/` |
| 外侧正面展示母图 | 外盾面近正视、完整居中，纹章、盾脐、包边和正面改造部位清楚；不表现背带 | 装备详情和改造面板的结构展示；写入 `equipImage` 与 `weaponAsset.image`，也是正面槽 `lineTarget` 的分析图 | 真透明RGBA，标准化为1024×1024，保留在 `assets/weapons/<slug>-equip.png`；不得用斜视手持图替代正面改造锚点图 |
| 内侧背面母图 | 与正面同一轮廓、尺度、上下方向和画布占比，清楚画出握柄、掌垫、前臂承带、扣件及其真实连接；不画手和手臂 | 每面新盾必做的结构真源，用于握点、背面改造槽和未来背面展示；当前不作为玩家运行纹理，也不能靠 `flipX` 伪造 | 真透明RGBA，至少1024×1024；保存在本盾生成包 `sources/<slug>-back-master.png` 和处理后的 `prepared/<slug>-back.png`，manifest登记 `backReference`。将来若有运行时背面状态，必须新增显式字段和独立512px副本，禁止复用 `guardImage` |
| 装备栏物品母图与128px图标 | 同一盾牌外侧的方形三分之四物品构图，方向与防御斜视图一致，但以图标辨识为目标重新居中放大；整盾不裁切，不带人物、文字、稀有度边框、投影或背景 | 装备栏、背包、商店、图鉴和地面掉落；正式路径同时写入 `iconImage`、`slotImage`、`dropImage` | 先保留至少1024px透明母图 `sources/<slug>-inventory-master.png`，再派生视觉居中的128×128 RGBA到 `assets/icons/shields/<slug>.png`；不得让UI临时缩放手持运行图充当图标 |

可改造盾牌还必须按第4、6节制作独立配件图标；这些图标不属于上述四类主体资产，不能替代背面结构图。若装备栏物品母图可由获准的防御斜视主母图无损重排得到，可以复用同一身份源，但仍必须单独输出并检查128px成品，不得只在配置里让多个字段指向未经图标构图处理的手持图。

### 3.2 持盾视觉角度标准（小圆盾基准）

- 基准样本为普通小圆盾 `weapon17`。玩家举稳时保留盾牌外侧正面可读性，同时形成中等三分之四防御视角；现有正面手持图使用 `defensePerspectiveScaleX: 0.74`，相当于约42°偏航下的水平投影比例。该角度只描述盾面相对相机的视觉投影，不改变格挡角、碰撞、伤害或角色朝向。
- `guardTilt` 只表示盾牌在屏幕平面内的顺/逆时针倾斜，不能当作透视角。运行时显示宽度为 `正面显示宽度 × lerp(1, defensePerspectiveScaleX, defenseBlend)`，高度不变；缩放围绕盾牌自身握点发生，必须与 `defenseOriginX/defenseOriginY` 共用举盾/收盾进度，禁止瞬间切换。
- 新盾牌从母图阶段就必须直接生成该斜视角：以约42°水平偏航为视觉基准，人物/持盾者位于画面左侧，外盾面朝向相机，近身侧左盾缘显示真实厚度和少量侧壁，远身侧右盾缘适当收束；盾牌竖轴保持自然，不把运行时 `guardTilt` 烘焙进母图。`0.74`只用于兼容既有近正面素材，不再作为新盾牌把正面图压窄的制作办法；新斜视母图登记 `defensePerspectiveScaleX: 1`。当前 `weapon57`—`weapon63`即为方向参照，不得二次压扁。
- 外侧正面展示母图继续保留可辨识的近正视构图，专供 `equipImage/weaponAsset.image` 和改造面板；装备栏、背包、商店、图鉴及掉落则使用独立方形三分之四图标。持盾透视只作用于 Phaser 手持层，不覆盖这些UI资产。斜视图上线后必须分别标定常态 `originX` 与盾面中段后的 `defenseOriginX`，并按有效Alpha重标 `visibleHeightRatio/defenseOriginY`；防御对照中手掌应被盾面遮住，但不能以伸长前臂、移动人体掌点或非等比拉伸身体来补救。
- 新增或重做盾牌时，先以 `assets/character/walk.png` 的0-based帧0/5/10/15/20和小圆盾防御GIF并看，确认头、胸、胯仍朝屏幕行进轴，盾面只是绕自身竖轴偏转。交付至少包含小圆盾动态基准、全部现役盾牌站立防御联系图，并分别核对左右镜像、掌点、中段握位、头肩遮挡和举/收盾连续性。
- 当前可直接复用的角度参考：静态斜视盾面联系图 `tools/ai-gen/weapon-gen/shield-guard-perspective-20260902/shield-guard-four-contact.png`；红色长盾在人物上的动态参考 `tools/animation/player-shield-walk-lower-20260902/shield-walk-oak-garrison-corrected.gif`；全部现役盾牌位置对照 `tools/animation/player-shield-walk-lower-20260902/shield-all-standing-guard.png`。参考图只规定相机、盾面方向和贴身关系，新盾仍必须保持自己的轮廓与身份。

### 3.3 同身份生成、派生与归档顺序

1. 先写身份卡：盾型和长宽比、外盾面材质/纹章、盾缘厚度、盾脐/中脊、背面骨架、握柄、承带、扣件与磨损位置。未确定背面握持结构时，不得先画随机背带再反推正面铆钉。
2. 第一张正式候选必须是防御斜视主母图，而不是平面正视图；关键角度通过后，将它作为身份参考生成外侧正面展示母图、内侧背面母图和装备栏物品母图。后续视图必须锁定同一轮廓、材质、颜色、纹章、铆钉数量和边缘缺口，不能只保留名称。
3. 正面与背面必须单独出图，不从一张前后概念大图直接切成低清运行资产。背面至少能解释一个掌握点和一个前臂固定点；塔盾可增加第二承带或肘托，但必须与设计和改造槽一致。
4. 所有母图先核对真实Alpha、完整轮廓、安全边和透明区RGB；生成服务若输出烘焙棋盘格，只移除与画布边缘连通的背景，不得把银白盾面、亮边或背带孔洞一起抠掉。处理后再派生1024px正式图、512px Phaser副本和128px装备栏图标。
5. 每个生成包必须保留提示词、身份参考、获准原图、处理脚本或可重建参数、四类资产路径、Alpha包围盒和一张按“防御斜视 / 外侧正面 / 内侧背面 / 装备栏128px”排列的联系图。manifest至少记录：

```json
{
  "shieldId": "<slug>",
  "weaponId": "weaponN",
  "identityReference": "sources/<slug>-guard-master.png",
  "views": {
    "guardExterior": {
      "source": "sources/<slug>-guard-master.png",
      "formal": "assets/weapons/guards/<slug>-guard.png",
      "runtime512": "assets/weapons/runtime/weapons/guards/<slug>-guard.png",
      "alphaBBox": [0, 0, 0, 0],
      "yawDegreesApprox": 42,
      "wielderSide": "image-left",
      "nearRim": "left"
    },
    "frontPresentation": {
      "source": "sources/<slug>-front-master.png",
      "formal": "assets/weapons/<slug>-equip.png",
      "alphaBBox": [0, 0, 0, 0]
    },
    "backReference": {
      "source": "sources/<slug>-back-master.png",
      "prepared": "prepared/<slug>-back.png",
      "alphaBBox": [0, 0, 0, 0]
    },
    "inventory": {
      "source": "sources/<slug>-inventory-master.png",
      "runtime128": "assets/icons/shields/<slug>.png",
      "alphaBBox": [0, 0, 0, 0]
    }
  },
  "shieldVisual": {
    "guardImage": "assets/weapons/guards/<slug>-guard.png",
    "originX": 0.5,
    "originY": 0.5,
    "defenseOriginX": 0.5,
    "defenseOriginY": 0.5,
    "visibleHeightRatio": 0.9,
    "bodyHeightRatio": 0.42,
    "defensePerspectiveScaleX": 1
  }
}
```

示例中的握点和尺寸只是字段占位，必须从本盾最终RGBA有效Alpha、背面握柄和防御预览重新测量，禁止照抄。左右移动仍只由运行时水平镜像同一张外盾面斜视图；镜像不会把外侧变成背侧，也不需要再生成一张反方向盾面。

### 3.4 四视图与配置交付门禁

- 身份一致：四张图的盾型、长宽比、纹章、主材质、包边、铆钉和损伤位置一致；背面固定件能够在正面找到合理连接位置。
- 角色隔离：主体资产均无人物、手、前臂、武器、文字、背景、投影和烘焙稀有度框；手掌遮挡只在玩家动画合成预览中检查。
- 字段分工：`guardImage`只指向防御斜视外盾面；`equipImage/weaponAsset.image`只指向外侧正面展示；`iconImage/slotImage/dropImage`指向正式128px装备栏图；背面只进manifest的 `backReference`，在没有显式运行时字段前不得接到上述任一字段。
- 输出齐全：生成包内四张母图/处理图、四视图联系图、提示词和manifest齐全；正式目录内高分手持图、正面展示图、512px手持副本和128px图标路径均存在。
- 防御预览：至少输出本盾站立防御图、21帧步行防御GIF和全盾联系图；核对掌部隐藏、头肩零侵入、左右镜像、举收盾连续性，以及 `defensePerspectiveScaleX: 1` 未被再次水平压缩。

## 4. 改造结构设计

- 优先使用“3个实体部位 × 每部位2或3选1”。部位必须能在盾牌结构上解释，连接线落到真实组件。正面组件使用暖灰长虚线与实心端点；背面握柄/承带必须在槽位写 `targetSide: 'back'`，使用蓝灰短虚线、异色端点和“背面”标识。背面端点表示从正面视图投影到掌点/承带中心的位置，不能冒充盾面上可见零件。
- 格子固定48×48px，槽位中心必须留在面板安全区，左右导轨同侧相邻中心距不得小于一个格子高度，连线不得互相交叉；完整名称通过悬停标题保留，格内允许省略显示。SVG必须显式占满改造容器并使用与容器一致的 `viewBox`，连接线、端点、编辑锚点和对齐参考线均需有正式样式，不能依赖浏览器默认SVG尺寸或默认描边。
- 每个选项必须同时写：组件名称、物理结构、数值效果、代价、效果键、互斥槽位、提示文案和图标ID。强效果至少牺牲物防、体力、时窗、移速或同槽机会之一。
- 九类标准方向：盾牌物防、主动格挡减伤、格挡体力、防御移动、弹反窗口、弹反眩晕、成功格挡后的下一击减伤、近战被动格挡、投射物被动格挡。单面盾不要求能同时安装九项。
- 当前优质盾牌样本见 [两款优质盾牌与改造项目设计](./designs/uncommon-shields-2026-08-31.md)；按约25%档位递推、同时保留轻/重路线取舍的稀有样本见 [两款稀有盾牌与改造项目设计](./designs/rare-shields-2026-09-02.md)；史诗档近战弹反返伤、魔法还击与魔抗削减的已接入样本见 [两款史诗盾牌与改造项目设计](./designs/epic-shields-2026-09-02.md)；神话档承势预备态与短时投射物场域的已接入样本见 [两款神话盾牌完整设计与接入](./designs/mythic-shields-2026-09-02.md)；传说档最终承伤延期与友方共享预算基准见 [两款传说盾牌完整设计与接入](./designs/legendary-shields-2026-09-02.md)。

### 虚线与改造格子的公式化部署算法

#### 1. 先判定是否应有改造布局

- 从 `EquipDataManager` 枚举所有 `type: '盾'` 的正式盾牌，再逐一检查craft配置。没有 `craft-config` 的盾牌属于明确不可改造，只显示“不可改造”状态；不得为了让面板有格子而凭空复制其他盾牌槽位。当前普通小圆盾 `weapon17` 即为该兼容分支。
- 可改造盾牌的分析图必须走 `src/ui/craft/weapon-image.js` 的改造栏展示图解析链，优先使用 `weaponAsset.image/equipImage` 指向的外侧正面展示图；不得使用斜视手持图、装备栏/掉落图标、背面结构参考图或塔载图计算正面锚点。
- 布局字段只允许使用 `id/name/x/y/lineTarget/targetSide`。`targetSide` 省略时视为正面；背面握柄、腕带或臂架必须显式写 `targetSide: 'back'`。

#### 2. 面板、安全区与Alpha锚点公式

基准面板为 `W=340`、`H=600`，格子边长 `S=48`。所有坐标最终保存为0—1归一化值，运行时再乘当前容器实测宽高；不得把340×600像素直接写入配置。

```text
px = 5, py = 21, gap = 15
xL = (S/2 + px) / W = 0.0853 ≈ 0.085
xR = 1 - xL          = 0.9147 ≈ 0.915
yMin = (S/2 + py) / H = 0.075
yMax = 1 - yMin       = 0.925
gMin = (S + gap) / H  = 0.105
```

- 格子中心只放在左右导轨 `xL/xR`；同侧相邻中心纵向距离必须 `>= gMin`。人工布局可以使用0.10/0.90等更保守的导轨，但不能突破由 `S/2` 决定的面板边界。
- 取展示PNG中 `alpha > 24` 的像素；为排除孤立毛边，四边各按累计可见像素的0.2%得到稳健Alpha包围盒 `B=(bx,by,bw,bh)`。结构配置中的语义锚点 `(u,v)` 基于该包围盒，而不是整张PNG。
- 将原图 `Iw×Ih` 以 `object-fit: contain` 放入面板：

```text
k  = min(W/Iw, H/Ih)
ox = (W - Iw*k) / 2
oy = (H - Ih*k) / 2
ax = bx + clamp(u,0,1) * (bw-1)
ay = by + clamp(v,0,1) * (bh-1)
tx = clamp((ox + ax*k) / W, 0.05, 0.95)
ty = clamp((oy + ay*k) / H, 0.04, 0.96)
```

- 正面锚点吸附到最近的有效Alpha像素后，仍须人工确认落在对应盾面、盾脐、包边或盾脊，不能只证明“碰到了盾”。背面锚点允许落在正面轮廓内部，语义是背部组件中心向当前正面视图的投影；它必须使用背面短虚线、异色端点和“背面”文字，不能寻找正面图上并不存在的握柄像素。

#### 3. 左右分配、排序与虚线路由

- `n>=2` 个槽位枚举 `2^n` 种左右分配；每侧至少1格、最多4格。各侧先按目标 `ty`、再按原槽位顺序稳定排序；将纵坐标夹在 `[yMin,yMax]`，向下和向上各扫一遍以保证 `gMin` 间距。单槽盾属于例外：当前生成器没有合法的双侧分配，必须人工放到推荐侧并在manifest说明，不能伪报自动候选通过。
- 当前候选评分使用以下代价，取最小者；`X` 为交叉数，`sideMismatch` 表示槽位没有放到结构配置的推荐侧：

```text
C = 2.8*X + 0.04*abs(nLeft-nRight)
    + sum(distance(cell,target))
    + 0.34*sum(sideMismatch)
```

- 运行时连接线统一为三点折线 `P0=(sx,sy) → P1=(ex,sy) → P2=(tx,ty)`。以像素计算肘点，保证格子先水平出线，再斜向组件：

```text
left : ex = min(tx-12, sx + max(18, (tx-sx)*0.58))
right: ex = max(tx+12, sx - max(18, (sx-tx)*0.58))
```

- 交叉检查必须对每条折线的两段逐段执行严格线段相交测试；共享同一端点可允许，除此之外任意交叉均不准发布。生成器manifest中的 `crossings` 目前是格心到端点直线的初筛值，不能替代最终三点折线检查。
- 正面线使用冷钢中性长虚线，背面线使用语义化短虚线；端点、编辑锚点和吸附参考线都必须有独立类。结构尺寸和层级可留在基础样式，颜色、描边、阴影、字体和状态色必须由 `ui/panel-theme-backpack.css` 的冷钢变量统一控制，不得在业务JS或 `game-style.css` 另建近似色板。

#### 4. 置信度、部署步骤与硬门禁

候选置信度只用于决定人工复核强度，不等于运行时通过。设 `U` 为未知语义锚点数，`D` 为平均Alpha吸附距离除以包围盒对角线，`X` 为候选初筛交叉数：

```text
confidence = clamp(0.95 - 0.07*U - 1.15*D - 0.08*X, 0.35, 0.98)
grade = A if confidence >= 0.86
        B if confidence >= 0.68
        C otherwise
```

配置自身的 `confidenceCap` 和人工复核名单可以继续压低等级；新盾牌默认至少按B级处理。部署顺序固定为：

1. 在 `craft-layout-profiles.js` 选择 `shield_round` / `shield_tower` 或新增有物理含义的盾型，登记各槽语义锚点和推荐侧；异形盾不得伪装成圆盾高置信度通过。
2. 在双份 `craft-config.json` 与 `craft-default-slots.js` 同步槽位字段；背面槽不得在复制或重置时丢失 `targetSide`。
3. 运行 `node tools/generate-craft-layouts.mjs`，生成 `craft-auto-layouts.js`、manifest和联系表。生成器只产候选，禁止自动覆盖正式配置。
4. A级也要看联系表；B级必须在面板人工检查并按需微调；C级必须补语义锚点或手工重排。只有点击“保存布局”才允许写回，取消必须恢复原布局。
5. 保存前逐盾执行硬门禁：双份JSON一致；默认布局字段一致；格子不越界且同侧中心距达标；实际两段折线交叉数为0；正面端点落在正确实体组件；背面端点有完整语义；自动候选仍保留相同槽位ID顺序。
6. `craft-lines-svg` 必须占满容器并设置同尺寸 `viewBox`；48px格子保留完整 `title/aria-label`。主题样式、鼠标命中、编辑拖动和右键归还属于运行时验收项，静态几何通过不能替代实机检查。

### 标准效果键

| 效果键 | 合同 |
|---|---|
| `shieldDefenseFlat` | 只加本盾物防 |
| `shieldBlockReductionBonus` | 主动格挡减伤百分点的小数增量，受最低承伤下限约束 |
| `shieldStaminaCostDelta` | 普通主动格挡体力增量，不复用普通攻击耗体字段 |
| `shieldDefenseMoveSpeedDelta` | 加到防御基础移速倍率；防御仍禁止冲刺 |
| `shieldParryWindowDelta` | 弹反窗口毫秒增量 |
| `shieldParryStunDelta` | 近战弹反眩晕毫秒增量；反制免疫仍优先 |
| `shieldAfterBlockGuard` | `{ reductionPercent, durationMs, cooldownMs, charges: 1 }`，成功普通主动格挡后赋予下一击减伤 |
| `shieldPassiveMeleeBlock` | `{ chance, reductionPercent, cooldownMs }`，非防御状态近战直击被动格挡 |
| `shieldPassiveProjectileBlock` | `{ chance, reductionPercent, cooldownMs }`，非防御状态显式投射物直击被动格挡 |

### 史诗机制扩展效果键

史诗盾牌允许在九类标准方向之外增加`与盾牌身份绑定`的机制改造，但必须先定义基础配置、标量增量键、统一聚合器和唯一消费者，不能用一个`applyMode: override`对象承载多个配件增量。

| 效果键 | 合同 |
|---|---|
| `shieldParryReflectRatioDelta` | 近战弹反返还比例增量 |
| `shieldParryReflectCapRatioDelta` | 返击伤害占玩家最大生命上限的比例增量 |
| `shieldParryReflectCooldownDelta` | 返击内部冷却毫秒增量 |
| `shieldMagicBlockReductionBonus` | 主动格挡对魔法/电击的额外减伤比例增量 |
| `shieldArcaneRetortBaseDamageDelta` | 奥术还击基础伤害增量 |
| `shieldArcaneRetortMatkRatioDelta` | 奥术还击`matk`系数增量 |
| `shieldArcaneRetortPreventedRatioDelta` | 奥术还击对弹反输入伤害的系数增量 |
| `shieldArcaneRetortMdefShredDelta` | 还击后魔抗削减比例增量 |
| `shieldArcaneRetortDurationDelta` | 魔抗削减持续时间毫秒增量 |
| `shieldArcaneRetortCooldownDelta` | 奥术还击内部冷却毫秒增量 |

基础字段`defense.parryReflection`、`defense.magicBlockRemainingDamageRatio`和`defense.arcaneRetort`属于装备配置；上表只描述改造对基础值的增量。注册表、聚合器、`ShieldSystem`、面板预览缺一项都不能宣称接入完成。

### 神话机制扩展效果键

神话盾牌可以增加跨多次格挡或短时场域机制，但仍必须留在统一主动盾牌入口内。运行态层数、预备态、短场和冷却必须绑定当前装备实例，并在换盾、换武器组、死亡、读档、场景切换或改造变化时清空；不得写入装备模板、存档公共字段或另建并行伤害管线。

| 效果键 | 合同 |
|---|---|
| `shieldReturnGuardRequiredStacksDelta` | 回天预备态所需普通主动格挡层数增量，聚合后限制为1—5层 |
| `shieldReturnGuardWindowPerStackDelta` | 每层承势为下一次防御追加的弹反窗口毫秒增量 |
| `shieldReturnGuardStaminaRefundPerStackDelta` | 强化弹反成功时每层返还体力的增量，不得超过玩家最大体力 |
| `shieldReturnGuardReadyDurationDelta` | 主动收盾后回天预备态保留时间的毫秒增量 |
| `shieldReturnGuardCooldownDelta` | 强化弹反完成、强化防御未命中、预备过期或强制中断后的机构冷却增量 |
| `shieldNullFieldTriggerStaminaDelta` | 事件视界吞没首发合格投射物时的独立体力消耗增量 |
| `shieldNullFieldDurationDelta` | 首发吞没后短场持续时间的毫秒增量 |
| `shieldNullFieldRemainingDamageRatioDelta` | 短场内后续合格投射物剩余承伤比例增量，聚合后限制为0—1 |
| `shieldNullFieldCooldownDelta` | 短场自然结束或提前收盾后的机构冷却增量 |
| `shieldNullFieldParryCooldownRefundDelta` | 成功弹反时返还现有事件视界冷却的毫秒增量，不得产生负冷却 |

基础字段`defense.returnGuard`和`defense.nullField`只描述装备本体。承势只记录支付普通格挡体力后的敌方直接普通格挡；达到需求后必须由玩家主动收盾才转为预备态。事件视界只接管显式`hitContext.isProjectile === true`的敌方直接投射物，并且排在成功弹反之后、普通格挡之前；首发吞没和场内减伤都不能冒充弹反。

### 传说机制扩展效果键

传说盾牌可以改写最终伤害的时间归属，或把个人格挡成果转换为友方共享预算，但必须保持伤害守恒、单一提供者和统一受击入口。负面延期状态不能通过换盾、保存、读档或切场免费清除；共享域不得按友军人数复制预算。

| 效果键 | 合同 |
|---|---|
| `shieldCausalDebtSplitRatioDelta` | 成功普通主动格挡后转为延迟劫债的最终承伤比例增量，聚合后限制为0—95% |
| `shieldCausalDebtCapRatioDelta` | 未偿劫债占玩家最大生命容量的比例增量，溢出立即承受 |
| `shieldCausalDebtGraceDelta` | 新劫债开始偿还前的宽限毫秒增量 |
| `shieldCausalDebtRepayDurationDelta` | 单笔劫债线性结清时长的毫秒增量，至少1ms |
| `shieldCausalDebtEraseRatioDelta` | 成功弹反抹除现存未偿劫债的比例增量，聚合后限制为0—95% |
| `shieldOathReserveConversionDelta` | 盾牌阶段实际阻止伤害转为誓约储备的比例增量 |
| `shieldOathReserveCapRatioDelta` | 誓约储备占持盾者最大生命上限的比例增量 |
| `shieldOathReserveDecayDelta` | 最后一次合格格挡后储备消散等待的毫秒增量 |
| `shieldOathSanctifyDurationDelta` | 成功弹反后允许主动收盾部署庇护域的窗口毫秒增量 |
| `shieldOathWardDurationDelta` | 终誓庇护域持续时间的毫秒增量 |
| `shieldOathWardRadiusDelta` | 终誓庇护域世界半径增量 |
| `shieldOathWardReductionDelta` | 域内合格直击从共享储备1:1支付的减伤比例增量 |

基础字段`defense.causalDebt`和`defense.oathReserve`属于装备本体。劫债只在本次攻击走完护甲、主动盾牌、余势与全局修正后拆分最终承伤；偿还不再走任何防御。终誓储备只记录支付普通格挡体力后的盾牌阶段阻止值；庇护域在每个目标自身防御之后消费一份共享储备，不能反向生成新储备。

## 5. 伤害顺序与触发边界

1. 护甲与暴击先结算。
2. 玩家主动防御成功时只走主动盾牌格挡，跳过自动格挡。
3. 未主动防御时，合格的自动格挡来源每次命中各判定一次，但同一命中只采用减伤最高的一个来源；盾牌被动、主手次级格挡和护甲自动格挡不得乘法叠加。
4. 已存在的“格挡后余势”在主动/自动格挡之后结算；本次刚成功格挡产生的新余势不能反过来减本次伤害。
5. 进入其他全局伤害修正；终誓庇护在目标自身所有防御之后消费共享储备。
6. 逆命劫债只对成功普通主动格挡留下的合格最终直击承伤做即时/延迟拆分。
7. 最后扣除即时生命；劫债后续偿还直接扣血，不再递归经过本顺序。

近战只认统一受击入口的 `isMelee === true`。投射物必须由发射与命中链显式传递 `hitContext.isProjectile === true`，不得用 `isMelee === false` 代替。DOT、环境、自伤、无来源范围伤害、无敌伤害不触发盾牌被动；被动格挡不耗体力、不触发弹反、不生成余势。

- 近战弹反反伤以“物防/魔防与暴击后、盾牌减伤前”的`parryInputDamage`为基数，受玩家最大生命比例封顶；返击不暴击、不吸血、不触发命中效果或连锁，并用独立`hitContext`标记阻断反伤递归。
- 魔法还击只认显式`damageType`的直接魔法/电击弹反；还击先经过目标魔防造成伤害，再施加魔抗削减，第一发不能吃到自身削减。
- 魔抗削减修改计算时的`effectiveMdef`，不得直接改写敌人配置`mdef`，也不得复用现有`magicVulnerability`终伤乘区。冷却只关闭史诗附加效果，不关闭普通弹反。
- 承势·回天在普通主动格挡成功并支付体力后记层；主动收盾完成预备转换，强制中断丢层并进入冷却。下一次举盾消费预备态，只扩展该次弹反窗口；成功弹反后才返还体力，未弹反收盾同样结束强化并进入冷却。
- 事件视界固定按“成功弹反 → 已展开短场 → 就绪首发吞没 → 普通格挡”判定。首发只扣专属触发体力，场内后续投射物不再支付普通格挡体力；体力不足或冷却中必须回退普通格挡，不能吞掉伤害或偷扣体力。
- 逆命劫债只认敌方近战或显式投射物直击。弹反按未偿余额抹债；保存、换盾、换武器组和场景切换先结清，死亡直接丢弃已无意义的运行态，不能靠状态切换套利。
- 终誓庇护必须经过“普通格挡积蓄→储备存在时弹反圣化→窗口内主动收盾部署”。储备耗尽、持续结束、卸盾、死亡和切场立即撤销唯一域提供者；DOT、环境、自伤、无来源和盾牌报复不享受域减伤。

## 6. 改造图标工作流

- 图标必须展示一个实体配件，不画整面盾、角色、手、武器、文字、数值箭头或多个散件。正面槽画钢板/木芯/盾脐/包边，背面槽画握柄/臂垫/承带。
- 风格以 `assets/icons/craft-cold-steel/` 为准：方形冷钢框、暗色圆形内盘、银钢倒角、四角铆钉、克制蓝色边光；在128px仍须一眼区分轮廓。
- 先保留模型原始母表、提示词和参考图记录，再派生独立RGBA高分辨率候选与128px候选，制作顺序总览。生成图的棋盘格可能是实色，必须检查真实Alpha后再抠图。
- 用户确认后才把高分辨率图移入正式图标目录、把128px副本移入DOM运行时镜像。改造图标不注册成Phaser纹理，也不让面板直接加载高分辨率原图。

## 7. 运行时接入门禁

获得实现授权后，按“效果注册 + 消费端 + 配置”三角落地：

1. 在 `src/config/craft-effect-registry.js` 登记每个新键、聚合模式与tooltip语义；对象效果不能按number求和。
2. 在 `getShieldDefenseValues` 统一聚合当前配对盾牌效果；盾系统、玩家物防、移动、伤害链与预览不得各自重复计算。
3. `data/craft-config.json` 与 `public/data/craft-config.json` 同步登记 `weaponN`、槽位、配件、图标、券耗和effects。
4. 投射物来源补齐显式 `isProjectile`，被动/余势的运行态按当前装备实例隔离，切盾、卸下、死亡、读档和场景切换时清理，不能串到备用武器组。
5. 改造展示坐标通过 `craft-default-slots` 的显示解析器生成候选，预览后人工调整并显式保存；盾牌使用 `shield_round` / `shield_tower` 结构配置，背面槽的 `targetSide` 必须由配置、默认布局、自动候选和保存链完整保留。`x/y/lineTarget/targetSide` 只影响面板，严禁混入战斗effects。

当前基准实现：`weapon56`—`weapon65` 已使用共享盾牌效果、三槽互斥和统一伤害链；其中`weapon60/61`是史诗机制扩展基准，`weapon62/63`是神话多阶段机制基准，`weapon64/65`是传说最终伤害延期与友方共享预算基准。后续盾牌应复用这些合同，不另建专用字段或并行格挡管线。普通小圆盾 `weapon17` 继续作为无改造兼容盾和手持视觉角度基准。

## 8. 交付与验证清单

- 静态范围核对：真实diff只覆盖本任务；双份JSON一致；ID、路径、图标Alpha、尺寸和effect键对应；旧盾牌与无改造盾仍走默认值。
- 获得运行时测试授权后：逐状态检查盾牌位置；验证主动格挡、弹反、破防、体力耗尽、防御移速、余势触发/过期/冷却、近战与投射物被动分类、同击多自动格挡择优、近战返击封顶与递归阻断、魔法还击分类与魔抗削减顺序、承势记层/主动收盾/强制中断/强化弹反/返还体力、事件视界首发吞没/场内比例/提前塌缩/冷却返还、劫债伤害守恒/上限溢出/弹反抹债/保存换盾切场结清/偿还致死、终誓储备积累/消散/圣化收盾/范围与持续/共享预算耗尽/各友方入口顺序/卸盾死亡切场撤域、tooltip与实际数值一致。
- 默认交付明确写出未运行的测试/构建/浏览器/游戏验证；不因“设计完成”“图标完成”宣称“已接入游戏”。EXE仅在用户明确要求后单独发布。

## 状态用语

- **设计完成**：数值、字段和边界已写文档，没有运行时代码。
- **候选素材完成**：有可审图文件，没有覆盖正式资源。
- **基础盾牌已接入**：装备与手持基础功能存在，不代表改造存在。
- **改造已接入**：registry、消费端、双份配置与正式图标闭环完成。
- **运行时已验证**：只有实际运行对应清单后才可使用。
