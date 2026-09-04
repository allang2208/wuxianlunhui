"""Document the completed source -> composite attack -> runtime import."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
FAMILY=ROOT.parent/'_hamster_howitzer_animations_20260830'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
m=read(FAMILY/'spritesheet-manifest.json');a=m['actions']['attack']
if not m.get('resupplyCompleted'): raise ValueError('Import the composite before publishing completion')
new=a['sourceSegments'][-1]
text=f'''# 榴弹炮取弹衔接：已接入开发版源码

在完整保留原8秒攻击的基础上，追加{new['durationMs']/1000:.4f}秒取弹段。两名仓鼠和炮车沿用原外形；装填手俯身伸手、取弹抬起、回到双手持弹待机。原抬炮/开火/退壳/装填轨迹与时点不变，死亡v04没有修改。未运行游戏测试，最终自然度与实机衔接由用户验收。

## 动作与时钟

- 完整攻击为 **{a['frameCount']}帧 / {a['durationMs']/1000:.4f}秒**；8秒开始取弹（成品第{a['resupplyStartOutputFrame']}帧）。原2.25秒出膛、3.96秒退壳声、6.08秒装填声不变，取弹段不再发射或播放炮声。
- 配置基础冷却仍为10秒；完整动作不得被下一次射击截断，因此实际连续射击周期下限变为约{a['durationMs']/1000:.2f}秒，另受AI决策间隔影响。既有前后台口径都取冷却与动画时长的较大值，不改伤害、射程、人口或科技费用。
- 仍使用同一个attack状态/纹理，不新增常驻表、不增加独立AI状态。移动命令、硬控、死亡沿用原中断规则；没有修改闲置、移动或死亡图集。

## 资产生产

- H3任务：`12f50365-4dbf-4fa4-9988-1d8d118804a2`；seed830907，20步，1024×576，73帧。用户明确同意两张已披露PNG及提示词发送至`192.168.3.142:8188`后提交，仅生成一次。授权与来源见`resupply-production.json`、`resupply-v01.mp4.json`。
- 原攻击80个关键帧保存在`before-resupply/attack-keys.png/json`；追加取弹源关键帧后统一执行2×RIFE，原关键帧仍位于偶数输出索引，不对已插帧成品重复插值。
- 全动作固定制作比例0.31，固定源脚点(512,420)，攻击格为{a['frameWidth']}×{a['frameHeight']}，脚点({a['footX']},{a['footY']:.1f})；各帧不重新居中或改变大小。
- 本次攻击图集{a['sheetSize'][0]}×{a['sheetSize'][1]}、{a['decodedMiB']:.3f}MiB；完整榴弹炮资源族（四动作+弹丸）**{m['decodedMiB']:.3f}MiB**，未超过64MiB准入上限。超过32MiB目标的主要原因仍是双人炮车、长攻击和宽幅烟焰；这是像素容量，并非实测显存。
- 此次更改`data/hamster-howitzer-crew-config.json`的attack帧表/时长、`assets/companions/hamster_howitzer_crew/attacking.png`及本单位源关键帧、manifest、预算与来源记录。未改全局预算或其它单位。

## 重建与验收边界

`resupply_sprites.py keys` → `interpolate` → `package` → `import`。插帧阶段用`.venv-sprites` Python，其余用ComfyUI Python。依赖已保留的原攻击关键帧、正式源视频和取弹视频；模型分割缓存可重建。`package`只生成候选，`import`才覆盖正式攻击图集。最后运行`write_resupply_delivery.py`、`write_delivery.py`和榴弹炮目录的`write_runtime_delivery.py`更新派生说明。

已查看源视频分镜与精灵表预览，并核对本次帧表、时长、炮口/声音事件和预算接线。未运行测试、lint、构建、浏览器/CDP或运行时验证，按约定由用户测试；固定EXE未更新。重点验收连续开火→装填→取弹→待机、左右镜像、改令中断、声画时点及攻速升级后的完整动作。

## 预览

[原8秒攻击视频]({(FAMILY/'videos/attack-v02.mp4').as_posix()}) · [新取弹视频]({(ROOT/'resupply-v01.mp4').as_posix()}) · [正式攻击精灵图]({(REPO/a['runtimePath']).as_posix()})

![完整攻击与取弹循环]({(ROOT/'attack-resupplied.gif').as_posix()})
'''
(ROOT/'RESUPPLY-DELIVERY.md').write_text(text,encoding='utf-8')
print('Wrote resupply delivery.')
