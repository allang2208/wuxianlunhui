# 仓鼠近代炮兵组运行时接入

状态：已按用户授权接入游戏代码与数据，等待用户实机验收；未运行游戏、测试、构建、浏览器/CDP或EXE发布。

## 解锁与生产

- 兵种key：`industrial_artillery_crew`；运行时配置id：`hamster_industrial_artillery_crew`。
- 生产建筑：`engineer_camp`；科技/编制：`engineer_camp_industrial`（近代炮兵制造，III级）。
- 招募成本：410粮食、210能源、105秒；军事人口2。
- 科技线：仓鼠投石组I → 仓鼠野战炮组II → 仓鼠近代炮兵组III → 仓鼠榴弹炮组IV。

## 战斗与弹道

- 基础生命540；六维27/15/7/25/7/6；移速58。
- 360物理伤害/9秒；1080最大射程、270最小射程、1280索敌范围。
- 范围半径105，`splashFalloff:0.6`，边缘保留40%伤害；后台按`expectedExtraTargets:1.6`使用同一炮兵AOE预算口径。
- 反坦克炮使用1100投射速度、45高度低伸抛物线。飞行继承现有炮兵的目标提前量、射程夹紧、16段开火前越墙检查、32段飞行墙体扫描、墙体受击与落点到敌人的遮挡检查。
- 炮弹从获准死亡源第28帧中的独立57毫米炮弹裁出，保持右向；显示26px。炮口锚点为动作图内右移151.2、抬高68.4，再按`displaySize/512`映射到世界。

## 动画时钟

- 待机50帧/4166.667ms循环；跑动24帧/2000ms循环；攻击87帧/5041.667ms单次；死亡113帧/5041.667ms单次，尸体额外保持1500ms。
- 运行时保留manifest逐帧时长，不把RIFE成片压回平均帧率。
- 攻击成片0-based第24帧是首个炮口事件；发射延迟为前24帧时长之和1416.667ms。发射、动作、音效和渲染共用`_catapultElapsedMs`，不另设视觉计时器。
- 攻击完整动作短于9秒攻击周期；动作结束后回待机，剩余冷却不会重播或重复发射。

## 运行时资源与注册

- 正式动作/炮弹：`assets/companions/hamster_industrial_artillery_crew/`。
- 正式配置：`data/hamster-industrial-artillery-crew-config.json`。
- UI图标：`assets/ui/unit-icons/hamster-industrial-artillery-crew.png`。
- 攻击/行走音频复用已认可野战炮声音内容，但复制为本单位独立文件名，避免跨单位资源所有权含混。
- 已登记生产实体、升级补丁、军事人口、编队、友军运行时资源、UI图标/分类、科技门禁与世界后台模拟。友军资源继续按需驻留，不加入Boot常驻预载。

`prepare_runtime_assets.py`可从已批准成片manifest重复生成正式动作、炮弹、图标、配置和来源记录；`runtime-asset-provenance.json`记录发布文件哈希。
