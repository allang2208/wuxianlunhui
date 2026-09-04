"""Write the human-readable delivery from the imported manifest."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
m = json.loads((ROOT/'spritesheet-manifest.json').read_text(encoding='utf-8'))
resupplied = m.get('resupplyCompleted', False)
attack_seconds = m['actions']['attack']['durationMs']/1000
labels={'idle':'待机v01','run':'移动v01','attack':'攻击v02','die':'死亡v04'}
lines=['# 仓鼠榴弹炮组：游戏接入交付','',
    '用户“可用，接入游戏”后导入开发版。保留已确认源片、动作轨迹、画面朝向与时长；固定EXE未更新。','',
    '## 玩法与科技','',
    '- 工程师营地、工程工坊、载具工厂分别招募投石组、野战炮组、榴弹炮组，三档已接入；升级只替换后续招募，已有低级部队保留。',
    '- 科技版本56，工程器械位于军事指挥独立支线。载具工厂保持科研基础920/曲线后4140，要求工程工坊、黑火药、蒸汽工业标准化、现代机械制造全部完成；已完成科技的旧档保留完成态。',
    '- 双人一组共享生命/命令，2军事人口，招募120秒、480食物、260能源。基础620HP、420物理伤害、10秒间隔、1150射程、250最小射程、125范围半径；六维/暴击和共享建筑升级沿用现有统一入口。',
    f'- 完整攻击{attack_seconds:.4f}秒：原8秒开火/退壳/装弹保持原时序，2.25秒出膛（源帧54→成品帧34）。' + ('末尾追加取下一发炮弹的衔接。' if resupplied else '') + '攻速升级不截断完整动作；实际射击周期下限按完整动画时长计算，前后台同源。死亡/移动命令/硬控取消未发射攻击。已飞出的弹丸按现有器械生命周期推进。',
    '- 弹丸从开火帧炮口出发，按预测落点抛射，朝向跟随屏幕弹道切线；墙体扫段和落点遮挡、伤害结算沿用投石组。后台仅估算平均额外命中，不模拟逐墙弹道。',
    '- 死亡5.1667秒：两人失衡侧倒、炮管断落，无开火。源片末尾约1.5秒保持倒地，游戏再保持最终帧1.5秒后清除。',
    '- 资源登记在FRIENDLY_UNIT_CONFIGS中按需加载/释放；没有追加Boot常驻素材，也没有修改固定EXE、建筑占格或全局纹理预算。','',
    '## 图集与预算','',
    '| 动作 | 原生关键帧→成品 | 帧格 | 图集 | 秒 | RGBA MiB | 脚点 |','|---|---:|---|---|---:|---:|---|']
for k,a in m['actions'].items():
    lines.append(f'| {labels[k]} | {len(a["sourceFrameIndices"])}→{a["frameCount"]} | '
        f'{a["frameWidth"]}×{a["frameHeight"]} | {a["sheetSize"][0]}×{a["sheetSize"][1]} | '
        f'{a["durationMs"]/1000:.4f} | {a["decodedMiB"]:.3f} | {a["footX"]}/{a["footY"]:.1f} |')
lines += ['',f'完整Phaser资源族（四动作+64×64弹丸）**{m["decodedMiB"]:.3f} MiB**，crowd目标32MiB、准入64MiB；没有额外召唤/伴生纹理依赖。256×256单位图标仅为DOM资源，不重复加载到Phaser。',
    '宽炮车、双人侧倒和炮口烟火导致超过32MiB目标；已按动作固定紧裁、低空格布局与全动作0.31同倍率降采样。0.32方案的四图为64.507MiB，因此未以该规格入库。',
    '三种器械现均可驻留；各资源族与工程全线容量见../_engineering_line_completion_20260830/DELIVERY.md。多种单位/建筑同场及下一波过渡仍服从既有512MiB稳态规划、640MiB管理软预算；这里是像素容量计算，不是实测显存/帧率保证。',
    f'源画布固定脚点(512,420)，制作比例0.31。手工按源站立仓鼠约260px头脚高度排除炮管后换算，displaySize={m["displaySize"]:.6f}，正常镜头身体约75.684px、计划最大镜头113.526px；机械组沿用投石组半径36/身体高100规格。各动作仅紧裁，不逐帧抬脚或缩放。',
    '慢段step4；开火50–72、倒地24–80保留原生逐帧姿态，装弹120–174每两帧取样。RIFE2×循环回绕/单次不回绕，所有原生关键帧保存在偶数索引，逐帧时长保持原片墙钟。',
    'RIFE生产器产物记录四动作visibleDarkOutlierFrames与visibleRedOutlierFrames为空，未用重复源帧兜底；没有另行运行预算检查、素材验证器或游戏测试。','',
    '## 限制与用户验收','',
    '- 原片仍保留；正式攻击图集在炮口外侧及顶部将烟焰Alpha柔化为零，消除硬裁边，没有补画画面外像素或改动人物/炮车轨迹。',
    '- 已从正式攻击v02提取炮击、退壳和装填音，分别在成功出膛、3.96秒和6.08秒单次触发；移动片持续底声未采用。未进行听感或运行时验收。',
    ('- 已获用户明确授权并追加H3取弹衔接；两段源视频、脚点与逐帧时长保存在sourceSegments。授权、预览和重建入口见../_engineering_line_completion_20260830/RESUPPLY-DELIVERY.md。' if resupplied else '- 装弹末尾空手切回持弹待机仍有源姿态接缝；取弹衔接尚未接入。'),
    '- 未运行测试或运行时验证，按约定由用户测试：三级解锁和旧档招募、2人口扣费、左右朝向出膛/退壳/装弹、最小射程后撤、升级、死亡完整播放与最终清除、切场恢复/资源卸载。',
    '- 已查看本次代码差异、局部接线与生成预览；没有lint、类型检查、构建、浏览器/CDP、启动游戏或同步EXE。','',
    '## 文件','',
    '- `data/hamster-howitzer-crew-config.json`；`src/entities/hamster-howitzer-crew.js`；`src/ai/hamster-howitzer-crew-ai.js`。',
    '- `data/producer-buildings.json`、`technology-tree.json`、`military-population-costs.json`、`building-upgrades.json`；`src/world/{producer-building-system,unit-upgrade-store,world122-sim,troop-line-system,technology-system}.js`。',
    '- `src/phaser/assets/friendly-unit-assets.js`；`src/config/{hamster-unit-icons,hamster-unit-categories}.js`；`assets/companions/hamster_howitzer_crew/`；`assets/ui/unit-icons/hamster-howitzer-crew.png`。',
    '- 本目录的`runtime-source-selection.json`锁定具体源版本；`spritesheet-manifest.json`派生运行时动画配置和`sprite-budget-manifest.json`。`task-index.json.actions`保留最初v01生成记录，当前运行时读取明确的activeRuntimeSourceSelection。','']
for k,a in m['actions'].items():
    lines += [f'### {labels[k]}','',f'[原视频]({(ROOT/a["video"]).as_posix()}) · [正式图集]({(REPO/a["runtimePath"]).as_posix()})','',
        f'![{labels[k]}]({(ROOT/a["preview"]).as_posix()})','']
    if a.get('sourceSegments'):
        lines += [f'[取弹衔接原视频]({(ROOT/a["sourceSegments"][-1]["video"]).resolve().as_posix()})','']
(ROOT/'RUNTIME-DELIVERY.md').write_text('\n'.join(lines),encoding='utf-8')
print('Wrote RUNTIME-DELIVERY.md')
