const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'game.js');
let s = fs.readFileSync(file, 'utf8');

const startMarker = '// 读取交互距离配置';
const endMarker = 'this.resolveCollisions();';

const startIdx = s.indexOf(startMarker);
const endIdx = s.indexOf(endMarker, startIdx);
if (startIdx === -1 || endIdx === -1) {
  console.error('Markers not found');
  process.exit(1);
}

const newBlock = `// 读取交互距离配置
        const interactCfg = GAME_CONFIG.interactionDistances || {};
        const npcClickDist = interactCfg.npcClick || 200;
        const npcHoverDist = interactCfg.npcHover || 40;
        const pickupClickDist = interactCfg.pickupClick || 150;
        const pickupHoverDist = interactCfg.pickupHover || 35;

        if (Input.mouse.leftPressed) {
            // NPC 对话检测（优先于拾取）
            if (NPCDialogue.active) {
                NPCDialogue.skip();
                Input.mouse.leftPressed = false;
                return;
            }
            let clickedNPC = false;
            let clickedPickup = false;
            for (const entity of this.entities.values()) {
                if (clickedNPC && clickedPickup) break;
                if (!clickedNPC && entity instanceof NPC && entity.active) {
                    const pdx = entity.x - this.player.x, pdy = entity.y - this.player.y;
                    const playerDist = Math.sqrt(pdx * pdx + pdy * pdy);
                    if (playerDist > npcClickDist) continue;
                    const pos = Renderer.worldToScreen(entity.x, entity.y);
                    const mx = Input.mouse.x, my = Input.mouse.y;
                    const hover = Math.sqrt((mx - pos.x) * (mx - pos.x) + (my - pos.y) * (my - pos.y)) < npcHoverDist;
                    if (hover) {
                        NPCDialogue.open(entity);
                        clickedNPC = true;
                        Input.mouse.leftPressed = false;
                    }
                }
                if (!clickedPickup && entity instanceof DropItem && entity.active) {
                    const pdx = entity.x - this.player.x, pdy = entity.y - this.player.y;
                    const playerDist = Math.sqrt(pdx * pdx + pdy * pdy);
                    if (playerDist > pickupClickDist) continue;
                    const pos = Renderer.worldToScreen(entity.x, entity.y);
                    const bobY = Math.sin(entity.bobOffset) * 4;
                    const mx = Input.mouse.x, my = Input.mouse.y;
                    const hover = Math.sqrt((mx - pos.x) * (mx - pos.x) + (my - (pos.y + bobY)) * (my - (pos.y + bobY))) < pickupHoverDist;
                    if (hover) {
                        const added = EquipManager.addToBackpack(entity.itemData);
                        if (added) {
                            entity.active = false;
                            // key unavailable in for-of, rely on cleanup pass
                            EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, \`拾取: \${entity.itemData.name}\`));
                            clickedPickup = true;
                            Input.mouse.leftPressed = false;
                        } else {
                            BackpackDialogManager._showBackpackFullNotice();
                        }
                    }
                }
            }
            if (clickedNPC) return;
        }

        // === [REFACTOR-START] 单次遍历：实体基础 update + 外部系统驱动 + 收集敌人 ===
        this._battleCommanderEnemies = [];
        for (const e of this.entities.values()) {
            if (!e.active) continue;
            e.update(dt, this.entities);
            if (e instanceof Enemy) {
                if (e.hp > 0) this._battleCommanderEnemies.push(e);
                if (typeof PerceptionSystem !== 'undefined') PerceptionSystem.update(e, dt, this.entities);
                if (typeof MovementSystem !== 'undefined') MovementSystem.update(e, dt, this.entities);
                if (typeof CombatSystem !== 'undefined') CombatSystem.update(e, dt, this.entities);
            }
        }
        // === [REFACTOR-END] ===

        // ===== 阵型系统更新（必须在实体 update 之后，为下一帧设置 _tacticalTarget）=====
        if (typeof FormationSystem !== 'undefined') {
            for (const e of this.entities.values()) {
                if (e.active) FormationSystem.update(e, dt, this.entities);
            }
        }

        // ===== 空间分区重建（所有AI系统的前置条件）=====
        if (typeof SpatialPartitionSystem !== 'undefined') {
            SpatialPartitionSystem.update(dt, this.entities);
        }

        // 协同效应系统更新
        if (this._synergySystem) {
            this._synergySystem.update(dt, this.entities);
        }

        // 指挥AI（BattleCommander）更新：根据战场态势选择战术并分配目标位置
        if (this._battleCommander && this.player && this._battleCommanderEnemies.length > 0) {
            this._battleCommander.update(dt, this.player, this._battleCommanderEnemies);
        }

        // 战术小队AI更新：控制类人型战术小队的协同行动
        if (this._tacticalSquadAI) {
            this._tacticalSquadAI.update(dt, this.player, this.entities);
        }

        // 战术小队角色动态切换（指挥官死亡后自动晋升）
        if (typeof TacticalSquadRoleSwitch !== 'undefined') {
            TacticalSquadRoleSwitch.update(dt, this.entities);
        }

        // ===== 单次遍历：金币自动拾取 + 清理死亡实体 + 传送门检测 =====
        const pickupCfg = GAME_CONFIG.pickup || {};
        const goldAutoRange = pickupCfg.goldAutoRange || 80;
        const goldThrowOutRange = pickupCfg.goldThrowOutRange || 80;
        const goldAutoRangeSq = goldAutoRange * goldAutoRange;
        const goldThrowOutRangeSq = goldThrowOutRange * goldThrowOutRange;
        const goldMaxStack = pickupCfg.goldMaxStack || 999;
        let goldStackItem = null;
        for (const bpItem of EquipManager.backpackItems) {
            if (bpItem.category === 'gold' && bpItem.stack < (bpItem.maxStack || goldMaxStack)) {
                goldStackItem = bpItem;
                break;
            }
        }

        const portalCfg = GAME_CONFIG.portals?.mainHub || {};
        const portalTriggerDist = portalCfg.triggerDistance || interactCfg.portalTrigger || 30;
        const portalCooldownMs = portalCfg.cooldownMs || 2000;
        const now = Date.now();
        const portalReady = this.player && !SceneManager.isLoading && now > this._portalCooldown;

        for (const [key, entity] of this.entities) {
            if (!entity.active) {
                if (entity._deathTime && now - entity._deathTime > (entity._deathRemoveDelay || 0)) {
                    this.entities.delete(key);
                }
                continue;
            }

            // 金币自动拾取
            if (entity instanceof DropItem && entity.itemData && entity.itemData.category === 'gold') {
                const dx = entity.x - this.player.x;
                const dy = entity.y - this.player.y;
                const distSq = dx * dx + dy * dy;
                if (entity.itemData._droppedByPlayer) {
                    if (distSq > goldThrowOutRangeSq) {
                        entity.itemData._wasOutOfRange = true;
                    }
                    if (!entity.itemData._wasOutOfRange) {
                        // still in throw-out range, skip
                    } else if (distSq <= goldAutoRangeSq) {
                        // try stack/add
                        let stacked = false;
                        if (goldStackItem && goldStackItem.stack < (goldStackItem.maxStack || goldMaxStack)) {
                            goldStackItem.stack += entity.itemData.stack;
                            stacked = true;
                        } else {
                            for (const bpItem of EquipManager.backpackItems) {
                                if (bpItem.category === 'gold' && bpItem.stack < (bpItem.maxStack || goldMaxStack)) {
                                    bpItem.stack += entity.itemData.stack;
                                    stacked = true;
                                    break;
                                }
                            }
                        }
                        if (stacked) {
                            entity.active = false;
                            this.entities.delete(key);
                            EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, \`+\${entity.itemData.stack} 金币\`, '#ffd700'));
                            if (typeof SoundManager !== 'undefined') {
                                SoundManager.playFile('assets/sounds/coins_wood_sharp.mp3');
                            }
                        } else if (EquipManager.backpackItems.length < EquipManager.maxBackpackSlots) {
                            EquipManager.addToBackpack(entity.itemData);
                            entity.active = false;
                            this.entities.delete(key);
                            EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, \`+\${entity.itemData.stack} 金币\`, '#ffd700'));
                            if (typeof SoundManager !== 'undefined') {
                                SoundManager.playFile('assets/sounds/coins_wood_sharp.mp3');
                            }
                        } else {
                            BackpackDialogManager._showBackpackFullNotice();
                        }
                    }
                } else if (distSq <= goldAutoRangeSq) {
                    let stacked = false;
                    if (goldStackItem && goldStackItem.stack < (goldStackItem.maxStack || goldMaxStack)) {
                        goldStackItem.stack += entity.itemData.stack;
                        stacked = true;
                    } else {
                        for (const bpItem of EquipManager.backpackItems) {
                            if (bpItem.category === 'gold' && bpItem.stack < (bpItem.maxStack || goldMaxStack)) {
                                bpItem.stack += entity.itemData.stack;
                                stacked = true;
                                break;
                            }
                        }
                    }
                    if (stacked) {
                        entity.active = false;
                        this.entities.delete(key);
                        EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, \`+\${entity.itemData.stack} 金币\`, '#ffd700'));
                        if (typeof SoundManager !== 'undefined') {
                            SoundManager.playFile('assets/sounds/coins_wood_sharp.mp3');
                        }
                    } else if (EquipManager.backpackItems.length < EquipManager.maxBackpackSlots) {
                        EquipManager.addToBackpack(entity.itemData);
                        entity.active = false;
                        this.entities.delete(key);
                        EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, \`+\${entity.itemData.stack} 金币\`, '#ffd700'));
                        if (typeof SoundManager !== 'undefined') {
                            SoundManager.playFile('assets/sounds/coins_wood_sharp.mp3');
                        }
                    } else {
                        BackpackDialogManager._showBackpackFullNotice();
                    }
                }
            }

            // 传送门检测
            if (portalReady && entity.targetScene) {
                const dx = entity.x - this.player.x, dy = entity.y - this.player.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < portalTriggerDist) {
                    this._portalCooldown = now + portalCooldownMs;
                    try {
                        if (entity.targetScene === 'scene7') {
                            this._showDungeonEntryConfirm(entity);
                        } else {
                            if (entity._isQuestReturn) {
                                QuestState.completeEvacuation();
                                QuestState.finishQuest();
                                SceneManager.switchScene(entity.targetScene, this.player);
                            } else {
                                SceneManager.switchScene(entity.targetScene, this.player);
                            }
                        }
                    } catch (err) {
                        console.error('[portal detection] switchScene error:', err);
                    }
                }
            }
        }

`;

const before = s.slice(0, startIdx);
const after = s.slice(endIdx);
fs.writeFileSync(file, before + newBlock + after);
console.log('game.js update block refactored');
