from pathlib import Path
import json
ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]

def update_json(path, change):
    data = json.loads(path.read_text(encoding='utf8'))
    change(data)
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')

def task(data):
    data.update(status='integrated_pending_user_runtime_acceptance',futurePlanOnly=False,
        runtimeIntegrationActive=True,gameplayDecisionsMade=True,
        userAcceptance='2026-09-01 好的，接入游戏；岗位自动生成、自动采矿交付、不可控制、设计升级并生成图标')
    data['productionPreparation'].update(profileStatus='crowd; 4-6 jobs per guild, at most 3 guilds in scene12',
        spriteSheetsCreated=True,runtimeBudgetCalculated=True,decodedTextureMiB=30.1982421875)
    data['animationRequest'].update(scope='Accepted mining, walking and loaded walking promoted through BiRefNet and 2x RIFE',
        animationUserApproval='accepted by integration request 2026-09-01',movementDirectionApproved=True,
        movementDirectionPreflight='checked against HMG before generation; approved via integration request',
        runtimeManifest='runtime/asset-manifest.json',formalPreview='runtime/accepted-actions.gif')
    data['review']['limitations'] = ['Game runtime not tested; user acceptance pending',
        'No separate death video: own idle pose fades on death',
        'Background transport uses abstract distance rather than live obstacle pathfinding']
    data['integrationDoc'] = 'docs/mining-guild-integration-2026-09-01.md'
    data['upgradeIcons'] = 'upgrade-icons/manifest.json'
update_json(ROOT/'task-index.json',task)

def movement(data):
    data['status']='accepted_and_integrated'
    data['orientationCheck']['userFinalSelection']='Accepted by user: 好的，接入游戏 (2026-09-01)'
    data['orientationCheck']['remaining']='Runtime visual acceptance remains with user; formal assets completed'
    data['runtimeIntegration']={'active':True,'manifest':'../runtime/asset-manifest.json','preview':'../runtime/accepted-actions.gif'}
update_json(ROOT/'animations-v02-direction/manifest.json',movement)

def guild(data):
    data.update(status='integrated_pending_user_runtime_acceptance',gameplayIntegrated=True,
        producerConfigRegistered=True,pendingGameplayDecisions=[],pendingIntegration=[],
        gameplayConfig='data/producer-buildings.json#mining_guild',workerConfig='data/hamster-mining-expert-config.json',
        integrationDoc='docs/mining-guild-integration-2026-09-01.md',groundFitGenerated=True)
update_json(REPO/'tools/ai-gen/_mining_guild_20260831/runtime/asset-registration.json',guild)

notes = [
    (ROOT/'README.md','## 当前状态：已接入，待用户运行验收（2026-09-01）\n\n用户已确认方向修订并要求接入。当前正式素材、岗位自动专家、采矿交付、存档/后台运输、科技与五项升级图标已完成；不替换普通矿工。详见 `../../../docs/mining-guild-integration-2026-09-01.md`、`runtime/asset-manifest.json` 和 `upgrade-icons/manifest.json`。三动作预览为 `runtime/accepted-actions.gif`。未运行测试或运行时验证，按约定由用户测试。\n\n以下保留此前制作历史，旧“待选稿/未接入”状态由本段覆盖。\n\n'),
    (ROOT/'animations-v02-direction/README.md','## 后续接入记录（2026-09-01）\n\n用户已以“好的，接入游戏”接受本轮方向。空载源24..60每2帧、负重20..50每2帧，经BiRefNet和2×RIFE分别得到38/32帧24fps正式循环。原片保留，负重采用本目录已确认的去尾尖处理；完整制作与预览见 `../runtime/asset-manifest.json`、`../runtime/accepted-actions.gif`。下文为生成阶段历史状态，运行时仍待用户测试。\n\n')]
for path,note in notes:
    source=path.read_text(encoding='utf8')
    pos=source.find('\n')+1
    path.write_text(source[:pos]+'\n'+note+source[pos:],encoding='utf8')

todo=REPO/'TODO.md'
source=todo.read_text(encoding='utf8')
start=source.index('## 矿业工会功能接入（素材已确认）')
end=source.index('\n## ',start+3)
replacement='''## 矿业工会运行验收

- 2026-09-01已完成工会与仓鼠矿业专家接入：scene12独特科技、4×4经济建筑、岗位自动生成/采矿/返营交付、五项升级及生成图标；MiniMax动作已转正式透明精灵并完成2×RIFE。普通矿工不替换。
- 说明与重点验收行为见 `docs/mining-guild-integration-2026-09-01.md`；素材、参数和离线动作预览见 `tools/ai-gen/_hamster_mining_expert_20260831/runtime/`。未运行测试或运行时验证，按约定由用户测试，不自动运行测试或发布EXE。
- 当前未制作独立死亡视频，使用专家自身待机姿势短暂淡出；后台运输按距离估算，不运行实体障碍寻路。是否后续补死亡动画或细化后台路线由用户决定。
'''
todo.write_text(source[:start]+replacement+source[end:],encoding='utf8')

changelog=REPO/'CHANGELOG.md'
source=changelog.read_text(encoding='utf8')
pos=source.find('\n')+1
entry='''
### 矿洞经济：矿业工会与自动仓鼠矿业专家（2026-09-01）

- 按用户确认接入工会：scene12独特科技320科研，4800能源/3000生命/双防80，4×4占地、最多3座。分配4个基础人口岗位后自动生成不可选中/指挥的矿业专家，升级最多6岗位，不增加军事招募入口。
- 专家基础采矿200/1500ms、背包1000、移速120；新增合金钻头/高速电机/晶石背架/助力矿靴/专家扩编，分别最多5/5/5/5/2级，完成后同步已有专家。普通矿工原参数与素材保留。
- 自动采矿先装个人背包，返抵工会后交付；满仓等待、撤岗先交付、矿尽交余矿、死亡丢矿和延时补员、建筑清理均接入。快照保存独立工会身份和每名专家的脚点/携矿/阶段；后台按路程与冷却继续采矿交付，不把背包直接入库，升级沿共享完成事件切分。
- 已接受MiniMax原片经BiRefNet固定比例裁框及2×RIFE输出空载38/负重32/采矿35帧24fps，静止首帧作为待机，约30.2MiB；按普通矿工身高校准，负重只切视觉。五个冷钢升级图标用内置image_gen逐张生成，209px正式与128px镜像入库，来源/提示词/预览完整保留；仅派生工会自身的缩略图与接地数据。
- 说明：`docs/mining-guild-integration-2026-09-01.md`。未运行测试或运行时验证，按约定由用户测试；死亡暂用自身姿势淡出，后台路径为距离估算。未构建/发布EXE、提交或推送，保留并行改动。

'''
changelog.write_text(source[:pos]+entry+source[pos:],encoding='utf8')
print('Integration provenance, TODO and CHANGELOG updated.')
