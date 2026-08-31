"""Publish the delivery notes after install-runtime and preview export."""
from pathlib import Path
import json

ROOT=Path(__file__).resolve().parent
GAME=ROOT.parents[2]

def save(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

manifest=json.loads((ROOT/'runtime-manifest.json').read_text(encoding='utf-8'))
selection=json.loads((ROOT/'selection.json').read_text(encoding='utf-8'))
selection.update({
    'status':'runtime_integrated_user_validation_pending',
    'finalSheet':'../../../assets/enemies/foreman_zombie/attacking_doubao_body.png',
    'finalPreview':'previews/foreman-whip-runtime-directions.gif',
    'manifest':'runtime-manifest.json',
    'bakedReferenceSheet':'sheets/foreman-whip-hybrid-candidate.png',
    'alignmentProof':'previews/foreman-whip-runtime-eight-directions.png',
    'alignmentStatus':'Fixed body scale and foot root; independent directional whip; shared action clock. Offline evidence only, no runtime acceptance.',
    'runtimeFilesChanged':True,'runtimeValidationPerformed':False,
    'pending':['User runtime review: eight directions, target moving behind, control interruption/release, walls/fog/viewport edge, death and scene exit.',
               'Short opacity idle crossfade may show a brief double silhouette; it is not generated skeletal in-between motion.'],
})
save(ROOT/'selection.json',selection)
hybrid=json.loads((ROOT/'hybrid-manifest.json').read_text(encoding='utf-8'))
hybrid['artifactRole']='baked side-view reference only; not the installed runtime sheet'
hybrid['runtimeDeliveryManifest']='runtime-manifest.json'
hybrid['knownLimits']=['This reference has no idle transition and only depicts left/right attacks.',
    'The installed body sheet, idle crossfade and independent directional whip are documented in runtime-manifest.json.',
    'No runtime validation performed; offline reference images do not prove game behavior.']
save(ROOT/'hybrid-manifest.json',hybrid)
contract=json.loads((ROOT/'alignment-integration-contract.json').read_text(encoding='utf-8'))
contract['status']='historical_baked_reference_contract_superseded_by_runtime_manifest'
contract['historicalRuntimeMismatches']=contract.pop('currentRuntimeMismatches',contract.get('historicalRuntimeMismatches',[]))
contract['runtimeManifest']='runtime-manifest.json'
save(ROOT/'alignment-integration-contract.json',contract)

(ROOT/'README.md').write_text('''# 工头甩鞭交付（2026-08-31）

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

## 重建

在仓库根目录依次运行：

```powershell
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/_foreman_whip_doubao_20260831/install-runtime.py
node tools/ai-gen/_foreman_whip_doubao_20260831/export-runtime-preview.mjs
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/_foreman_whip_doubao_20260831/render-runtime-preview.py
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/_foreman_whip_doubao_20260831/write-runtime-delivery.py
```

只消费现存透明缓存和RIFE中间表，不重调模型。`build-hybrid.py`只制作历史烘焙侧向参考，不能将其640×328表覆盖当前人体表。四条视频、提示词和来源记录仍保留；未选视频和中间件没有替换正式资源。

未运行测试或运行时验证，按约定由用户测试；未构建、启动游戏、浏览器探针、提交或同步EXE。重点体验八方向、目标绕后、石化解除、其他强控、墙体/迷雾/视口边缘，以及死亡和离场后的鞭层清理。
''',encoding='utf-8')

(GAME/'docs/foreman-whip-alignment-2026-08-31.md').write_text('''# 工头动画对齐与修复交付

2026-08-31：用户确认“修复”后，已将豆包人体动作和独立鞭层接入开发版。此前“游戏仍用31帧、候选未接入”的评审结论已被本次实现取代。这里记录代码与素材交付，不代表游戏运行验收。

## 修复范围

1. **大小与固定脚点。** 五动作沿用512参考格和480显示基准，X/Y均0.9375。新攻击紧裁为352×320、61帧，脚点140/304，显示画布330×300；画布尺寸变化不改变人体尺度。旧待机/行走/号召/死亡仍为512画格、脚点256/414。共同脚点对齐现有Collider（偏移+6/−20），不移动碰撞体。旧状态footOffsetY=168.125，新攻击=155；横向镜像补偿基于脚点，不能使用画格中心代替。旧候选误差36素材像素已消除。
2. **同源时钟。** 人体、独立鞭层、音效和命中均读取逻辑动作进度及frameDurations；资源晚加载不从动画首帧重新计时。1500ms总时长不变，第36帧870.9677ms判定，第30帧725.8065ms音效。逻辑长帧跨过接触窗口时呈现一次接触姿势，之后收尾，伤害仍只结算一次。
3. **方向与范围。** 起手锁定目标及未压缩地面方向；人物左右翻转、鞭层投影和近战判定均消费这次快照，目标绕后不重新追踪。独立鞭层跟随当前身体手部，接触末端为`脚点 + 锁定方向×320（Y乘0.5）−打击高度`。打击高度起手按目标高度锁定；伤害仍走公共单目标解析器，不扩大判定来掩盖错位。
4. **消除重复与裁切。** 正式攻击表只包含人体和起落衔接，鞭子由独立Graphics绘制，不受人体画格裁边；移除旧220ms额外长鞭。视觉视口半径显式400，不修改身体、碰撞或攻击范围。鞭层继承身体可见性、遮罩、透明度和遮挡深度，接入迷雾、地图模式、死亡/中断清理及场景shutdown。
5. **状态衔接。** 攻击首尾沿用原盘鞭待机做约75ms固定脚点交叉淡化，鞭层同步渐显/隐，不改命中时刻。石化保存已显示帧及朝向并取消未结算攻击；解除后回待机，不恢复旧伤害。其他强控中断攻击并清鞭。号召和死亡也改为逻辑时钟选帧，不改变其时长、增益或尸体保留规则。
6. **资源。** 原待机只用第一格，现无损裁成512单格；旧文件保留。工头直接贴图RGBA估算112.0703MiB，原148MiB；未重审矿洞/召唤依赖闭包，不作为GPU实测数据。

伤害×2、流血1层、射程320、宽26、4500ms冷却、移动速度、碰撞尺寸、号召增益、矿洞生成和存档规则保持。墙体视线、承载面、目标失效等仍由既有近战解析器处理。

## 文件

- `src/entities/enemy-types/foreman-zombie.js`：状态、固定脚点、同源时钟、锁向及强控中断。
- `src/entities/enemy-types/_shared/foreman-whip-geometry.js`：独立鞭身方向投影。
- `src/effects/foreman-whip-visual.js`：附属视觉层与清理。
- `src/phaser/scenes/BootScene.js`：按新布局切片、注册61帧。
- `src/phaser/scenes/GameScene.js`：最终身体姿态后的鞭层同步、视口及迷雾接线。
- `data/enemy-config.json`及`public/data/enemy-config.json`：仅本次工头字段；共享文件的其他会话改动保留。
- `data/foreman-whip-motion.json`及公开副本：61帧手点、曲线、时长和衔接权重。
- `assets/enemies/foreman_zombie/attacking_doubao_body.png`、`idle_single.png`：正式素材。
- `tools/ai-gen/_foreman_whip_doubao_20260831/`：源视频、透明缓存、导出脚本、清单及预览。

## 查看与验收边界

[四方向GIF](../tools/ai-gen/_foreman_whip_doubao_20260831/previews/foreman-whip-runtime-directions.gif)、[八方向接触图](../tools/ai-gen/_foreman_whip_doubao_20260831/previews/foreman-whip-runtime-eight-directions.png)、[衔接图](../tools/ai-gen/_foreman_whip_doubao_20260831/previews/foreman-whip-runtime-transitions.png)消费正式PNG与生产投影函数，属于离线素材展示。GIF缩为80%且首尾各停250ms方便查看，不是游戏实际画布或攻击延迟。

新素材是豆包人体、BiRefNet/RIFE处理与独立皮鞭的混合制作，不是未修改的AI原片。上下/斜向仍共用侧身人体，只调整鞭层投影；起落淡化有短暂双轮廓，未生成八方向骨骼姿势或宣称视觉完全无缝。

已查看本次真实差异及必要调用链，没有进行额外全局审计。未运行测试或运行时验证，按约定由用户测试；未构建、启动游戏、浏览器/CDP检查或同步EXE。请重点测试八方向出鞭、目标绕后/走出范围、墙后空挥、石化/眩晕解除、视口边缘和迷雾遮挡、死亡/换场残留。
''',encoding='utf-8')
print('Updated runtime delivery notes and superseded candidate status.')
