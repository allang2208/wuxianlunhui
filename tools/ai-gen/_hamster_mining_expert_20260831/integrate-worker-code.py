"""Narrow one-time source edits; preserves the preexisting shared working tree."""
from pathlib import Path
import shutil
ROOT = Path(__file__).resolve().parents[3]
BACKUP = Path(__file__).resolve().parent / 'integration-baseline'
BACKUP.mkdir(exist_ok=True)

def edit(path, fn):
    p = ROOT / path
    backup = BACKUP / p.name
    if not backup.exists():
        shutil.copy2(p, backup)
    text = p.read_text(encoding='utf8')
    p.write_text(fn(text), encoding='utf8')

def hut(s):
    s = s.replace("import { HamsterMiner } from '../entities/hamster-miner.js';", "import { HamsterMiner } from '../entities/hamster-miner.js';\nimport { HamsterMiningExpert } from '../entities/hamster-mining-expert.js';")
    s = s.replace('TWO_BY_TWO_BUILDING_FOOT, applyBuildingFootprint', 'TWO_BY_TWO_BUILDING_FOOT, getBuildingFootprint, applyBuildingFootprint')
    s = s.replace('MINER_CAMP_CONFIG, getMinerEconomyStats', 'MINER_CAMP_CONFIG, getMinerEconomyStats, getMiningWorkerProfile')
    s = s.replace('getHutModuleCost(moduleId, _currentLevel)', "getHutModuleCost(moduleId, _currentLevel, cfgKey = 'hamster_hut')")
    s = s.replace('getBuildingModuleUpgradeCost(MINER_CAMP_CONFIG, moduleId, _currentLevel)', 'getBuildingModuleUpgradeCost(getMiningWorkerProfile(cfgKey).building, moduleId, _currentLevel)')
    s = s.replace('getHutModuleDesc(moduleId, level)', "getHutModuleDesc(moduleId, level, cfgKey = 'hamster_hut')")
    s = s.replace('const mod = HAMSTER_CONFIG.modules?.[moduleId];', 'const mod = getMiningWorkerProfile(cfgKey).building.modules?.[moduleId];', 1)
    s = s.replace('getHutMults(modules)', "getHutMults(modules, cfgKey = 'hamster_hut')")
    s = s.replace('return getMinerEconomyStats(modules);', 'return getMinerEconomyStats(modules, null, cfgKey);')
    begin = s.index('export class HamsterHut extends')
    end = s.index('// ==================== 矿工营地升级面板')
    part = s[begin:end]
    part = part.replace('const hp = config.hp ?? HAMSTER_CONFIG.hut.hp;', "const profile = getMiningWorkerProfile(config.cfgKey);\n        const cfg = { ...profile.building, maxLevel: 10 };\n        const hp = config.hp ?? cfg.hp;")
    part = part.replace('HAMSTER_CONFIG.hut', 'this._cfg').replace('HAMSTER_CONFIG.miner', 'this._workerCfg.ai').replace('HAMSTER_CONFIG.modules', 'this._cfg.modules')
    part = part.replace('size: this._cfg.displayW,', 'size: cfg.displayW,',1)
    part = part.replace('collisionRadius: this._cfg.radius,', 'collisionRadius: getBuildingFootprint(cfg.footprintCells || 2).collisionRadius,',1)
    part = part.replace("name: config.name ?? '矿工营地',", 'name: config.name ?? cfg.name,',1)
    part = part.replace('this._cfg = this._cfg;', "this._cfg = cfg;\n        this.cfgKey = cfg.id;\n        this._workerCfg = profile.unit;\n        this._isMiningGuild = cfg.id === 'mining_guild';\n        this._restoredMinerWorkers = this._isMiningGuild && Array.isArray(config.minerWorkers)\n            ? config.minerWorkers.map((worker) => ({ ...worker })) : [];")
    part = part.replace('applyBuildingFootprint(this, 2);', 'applyBuildingFootprint(this, cfg.footprintCells || 2);')
    part = part.replace('return getHutMults(this.modules);', 'return getHutMults(this.modules, this.cfgKey);')
    part = part.replace('getHutModuleCost(moduleId, this.modules[moduleId] || 0)', 'getHutModuleCost(moduleId, this.modules[moduleId] || 0, this.cfgKey)')
    part = part.replace('const spot = this._findMinerSpawn();', "const restored = this._restoredMinerWorkers[0];\n        const hasPosition = restored && Number.isFinite(restored.x) && Number.isFinite(restored.y);\n        const spot = hasPosition ? { x: restored.x, y: restored.y } : this._findMinerSpawn();")
    part = part.replace('const miner = new HamsterMiner(spot.x, spot.y, {', 'const Worker = this._isMiningGuild ? HamsterMiningExpert : HamsterMiner;\n        const miner = new Worker(spot.x, spot.y, {')
    part = part.replace('miner._spawnEgress = { x: spot.egressX, y: spot.egressY };', "if (restored) {\n            this._restoredMinerWorkers.shift();\n            miner._energyCarried = Math.max(0, Number(restored.carried) || 0);\n            miner._retireRequested = !!restored.retiring;\n            miner._ai._phase = ['work', 'unload_return', 'storage_wait'].includes(restored.phase) ? restored.phase : 'work';\n            miner._ai._attackTimer = Math.max(0, Number(restored.attackTimer) || 0);\n            if (restored.hp > 0) miner.data.hp = Math.min(miner.data.maxHp, restored.hp);\n        }\n        if (!hasPosition) miner._spawnEgress = { x: spot.egressX, y: spot.egressY };")
    part = part.replace('lost > 0 ? `矿工营地被摧毁（暂存 ${lost} 能源丢失）` : \'矿工营地被摧毁\'', 'lost > 0 ? `${this._cfg.name}被摧毁（暂存 ${lost} 能源丢失）` : `${this._cfg.name}被摧毁`')
    s = s[:begin]+part+s[end:]
    # Panel consumes the selected owner's profile, keeping one economic UI implementation.
    begin = s.index('// ==================== 矿工营地升级面板')
    part = s[begin:].replace('HAMSTER_CONFIG.modules', 'this.hut._cfg.modules').replace('HAMSTER_CONFIG.hut', 'this.hut._cfg')
    part = part.replace("name: '矿工营地',", 'name: h._cfg.name,')
    part = part.replace('getHutModuleDesc(moduleId, lv)', 'getHutModuleDesc(moduleId, lv, h.cfgKey)')
    part = part.replace('<span>矿工营地升级项目</span>', '<span>${h._cfg.name}升级项目</span>')
    part = part.replace('适用单位：仓鼠矿工', "适用单位：${h._workerCfg.name}")
    part = part.replace('出售返还 ${refund} 能源（仓鼠矿工一并拆除）', '出售返还 ${refund} 能源（${h._workerCfg.name}一并拆除）')
    part = part.replace('<span>矿工岗位</span>', '<span>${h._isMiningGuild ? \'专家\' : \'矿工\'}岗位</span>')
    part = part.replace('新增岗位会立即生成矿工；能源只在矿工返营提交后进入仓库。', '分配人口后自动生成${h._workerCfg.name}，不接受玩家指挥；能源只在返营交付后入库。')
    s = s[:begin]+part
    return s

def building(s):
    s = s.replace("if (item?.kind !== 'producer') return 2;", "if (!['producer', 'hamster_hut'].includes(item?.kind)) return 2;")
    s = s.replace("kind: 'producer',\n        buildCategory:", "kind: pc.workerController === 'hamster_miner' ? 'hamster_hut' : 'producer',\n        economyType: pc.economyType || null,\n        buildCategory:")
    s = s.replace("'hamster_hut', 'deep_drill'", "'hamster_hut', 'mining_guild', 'deep_drill'")
    # Catalog-backed worker buildings need the same plane/limit/road gates as producers.
    s = s.replace("item?.kind === 'producer' ? PRODUCER_BUILDINGS[item.id] : null", "isProducerKind(item) ? PRODUCER_BUILDINGS[item.id] : null")
    s = s.replace("return item.kind !== 'producer'\n        || PRODUCER_BUILDINGS[item.id]?.perimeterTile !== 'none';", "return PRODUCER_BUILDINGS[item.id]?.perimeterTile !== 'none';")
    s = s.replace("const count = (ProducerBuildingSystem?.buildings || []).filter((building) =>", "const candidates = cfg.workerController === 'hamster_miner' ? HamsterHutSystem.huts : ProducerBuildingSystem?.buildings;\n            const count = (candidates || []).filter((building) =>")
    s = s.replace('this._ghost.setDisplaySize(HAMSTER_CONFIG.hut.displayW, HAMSTER_CONFIG.hut.displayH);', "const cfg = PRODUCER_BUILDINGS[item.id] || HAMSTER_CONFIG.hut;\n                this._ghost.setDisplaySize(cfg.displayW, cfg.displayH);")
    s = s.replace("this._placing.item.kind === 'hamster_hut' ? HAMSTER_CONFIG.hut : null", "this._placing.item.kind === 'hamster_hut' ? (PRODUCER_BUILDINGS[this._placing.item.id] || HAMSTER_CONFIG.hut) : null")
    s = s.replace("if (this._placing.item.kind === 'hamster_hut') return HAMSTER_CONFIG.hut.footOffsetY;", "if (this._placing.item.kind === 'hamster_hut') {\n            return (PRODUCER_BUILDINGS[this._placing.item.id] || HAMSTER_CONFIG.hut).footOffsetY;\n        }")
    s = s.replace('new HamsterHut(x, y, { id })', 'new HamsterHut(x, y, { id, cfgKey: item.id })')
    s = s.replace('HamsterHutSystem.huts.push(hut);\n                placedEntity', 'HamsterHutSystem.huts.push(hut);\n                RuntimeAssetManager.commitBuildingEntities(Game.entities.values());\n                placedEntity')
    return s

edit('src/world/hamster-hut-system.js',hut)
edit('src/world/building-system.js',building)
