import hamsterMinerConfig from '../../../data/hamster-miner-config.json';
import hamsterWarriorConfig from '../../../data/hamster-warrior-config.json';
import hamsterChampionConfig from '../../../data/hamster-champion-config.json';
import hamsterShooterConfig from '../../../data/hamster-shooter-config.json';
import hamsterGuardConfig from '../../../data/hamster-guard-config.json';
import hamsterPhalanxConfig from '../../../data/hamster-phalanx-config.json';
import hamsterRiotSquadConfig from '../../../data/hamster-riot-squad-config.json';
import hamsterSpecialForcesConfig from '../../../data/hamster-special-forces-config.json';
import hamsterTrenchAssaultConfig from '../../../data/hamster-trench-assault-config.json';
import hamsterAntiTankRiflemanConfig from '../../../data/hamster-anti-tank-rifleman-config.json';
import hamsterIndustrialReconRiflemanConfig from '../../../data/hamster-industrial-recon-rifleman-config.json';
import hamsterSteelShieldAssaultConfig from '../../../data/hamster-steel-shield-assault-config.json';
import hamsterMilitiaConfig from '../../../data/hamster-militia-config.json';
import hamsterHalberdierConfig from '../../../data/hamster-halberdier-config.json';
import hamsterScoutConfig from '../../../data/hamster-scout-config.json';
import hamsterRangerConfig from '../../../data/hamster-ranger-config.json';
import hamsterCrossbowConfig from '../../../data/hamster-crossbow-config.json';
import hamsterLongbowConfig from '../../../data/hamster-longbow-config.json';
import hamsterAssaultConfig from '../../../data/hamster-assault-config.json';
import hamsterHeavyMachineGunnerConfig from '../../../data/hamster-heavy-machine-gunner-config.json';
import hamsterSniperConfig from '../../../data/hamster-sniper-config.json';
import hamsterServiceRiflemanConfig from '../../../data/hamster-service-rifleman-config.json';
import hamsterBarAutomaticRiflemanConfig from '../../../data/hamster-bar-automatic-rifleman-config.json';
import hamsterMusketeerConfig from '../../../data/hamster-musketeer-config.json';
import hamsterAntiVehicleConfig from '../../../data/hamster-anti-vehicle-config.json';
import hamsterPriestConfig from '../../../data/hamster-priest-config.json';
import hamsterKnightConfig from '../../../data/hamster-knight-config.json';
import hamsterLightCavalryConfig from '../../../data/hamster-light-cavalry-config.json';
import hamsterCavalryConfig from '../../../data/hamster-cavalry-config.json';
import hamsterWingedHussarConfig from '../../../data/hamster-winged-hussar-config.json';
import hamsterIndustrialCarbineCavalryConfig from '../../../data/hamster-industrial-carbine-cavalry-config.json';
import hamsterIndustrialHeavyLancerConfig from '../../../data/hamster-industrial-heavy-lancer-config.json';
import hamsterScoutRifleSkirmisherConfig from '../../../data/hamster-scout-rifle-skirmisher-config.json';
import hamsterPoweredEodExplosiveLancerConfig from '../../../data/hamster-powered-eod-explosive-lancer-config.json';
import hamsterNinjaConfig from '../../../data/hamster-ninja-config.json';
import hamsterSamuraiConfig from '../../../data/hamster-samurai-config.json';
import hamsterExplorerConfig from '../../../data/hamster-explorer-config.json';
import hamsterBountyHunterConfig from '../../../data/hamster-bounty-hunter-config.json';
import jaguarWarriorConfig from '../../../data/jaguar-warrior-config.json';
import junglePriestConfig from '../../../data/jungle-priest-config.json';
import desertPriestConfig from '../../../data/desert-priest-config.json';
import hamsterCamelCavalryConfig from '../../../data/hamster-camel-cavalry-config.json';

export const FRIENDLY_UNIT_CONFIGS = Object.freeze([
    hamsterMinerConfig,
    hamsterWarriorConfig,
    hamsterChampionConfig,
    hamsterShooterConfig,
    hamsterGuardConfig,
    hamsterPhalanxConfig,
    hamsterRiotSquadConfig,
    hamsterSpecialForcesConfig,
    hamsterTrenchAssaultConfig,
    hamsterAntiTankRiflemanConfig,
    hamsterIndustrialReconRiflemanConfig,
    hamsterSteelShieldAssaultConfig,
    hamsterMilitiaConfig,
    hamsterHalberdierConfig,
    hamsterScoutConfig,
    hamsterRangerConfig,
    hamsterCrossbowConfig,
    hamsterLongbowConfig,
    hamsterAssaultConfig,
    hamsterHeavyMachineGunnerConfig,
    hamsterSniperConfig,
    hamsterServiceRiflemanConfig,
    hamsterBarAutomaticRiflemanConfig,
    hamsterMusketeerConfig,
    hamsterAntiVehicleConfig,
    hamsterPriestConfig,
    hamsterKnightConfig,
    hamsterLightCavalryConfig,
    hamsterCavalryConfig,
    hamsterWingedHussarConfig,
    hamsterIndustrialCarbineCavalryConfig,
    hamsterIndustrialHeavyLancerConfig,
    hamsterScoutRifleSkirmisherConfig,
    hamsterPoweredEodExplosiveLancerConfig,
    hamsterNinjaConfig,
    hamsterSamuraiConfig,
    hamsterExplorerConfig,
    hamsterBountyHunterConfig,
    jaguarWarriorConfig,
    junglePriestConfig,
    desertPriestConfig,
    hamsterCamelCavalryConfig,
]);

const CONFIG_BY_ID = new Map(FRIENDLY_UNIT_CONFIGS.map((config) => [config.id, config]));

export function getFriendlyUnitConfig(id) {
    return CONFIG_BY_ID.get(id) || null;
}

export function getKnownFriendlyUnitIds(ids) {
    const result = [];
    const seen = new Set();
    for (const id of ids || []) {
        if (!CONFIG_BY_ID.has(id) || seen.has(id)) continue;
        seen.add(id);
        result.push(id);
    }
    return result;
}

export function friendlyUnitTextureKey(unitId, animKey) {
    return `companion_${unitId}_${animKey}`;
}

export function queueFriendlyUnitAssets(scene, ids) {
    const queued = [];
    for (const id of getKnownFriendlyUnitIds(ids)) {
        const config = CONFIG_BY_ID.get(id);
        for (const [animKey, def] of Object.entries(config.animations || {})) {
            if (!def?.src) continue;
            const textureKey = friendlyUnitTextureKey(id, animKey);
            if (scene.textures.exists(textureKey)) continue;
            scene.load.spritesheet(textureKey, def.src, {
                frameWidth: def.frameWidth || 512,
                frameHeight: def.frameHeight || 512,
                endFrame: Math.max(0, (def.frameCount || 1) - 1),
            });
            const cells = Math.max(1, (def.cols || 0) * (def.rows || 0), def.frameCount || 1);
            queued.push({
                key: textureKey,
                estimatedBytes: (def.frameWidth || 512) * (def.frameHeight || 512) * cells * 4,
            });
        }
    }
    return queued;
}

export function registerFriendlyUnitAnimations(scene, ids) {
    const applyFrameDurations = (frames, durations, sourceStart = 0) => {
        if (!Array.isArray(durations) || durations.length === 0) return frames;
        frames.forEach((frame, index) => {
            const duration = durations[sourceStart + index];
            if (Number.isFinite(duration) && duration > 0) frame.duration = duration;
        });
        return frames;
    };
    for (const id of getKnownFriendlyUnitIds(ids)) {
        const config = CONFIG_BY_ID.get(id);
        for (const [animKey, def] of Object.entries(config.animations || {})) {
            if (!def?.src) continue;
            const textureKey = friendlyUnitTextureKey(id, animKey);
            if (!scene.textures.exists(textureKey) || scene.anims.exists(textureKey)) continue;
            if (def.startFrames && def.loopFrames) {
                const [startStart, startEnd] = def.startFrames;
                const [loopStart, loopEnd] = def.loopFrames;
                scene.anims.create({
                    key: `${textureKey}_start`,
                    frames: applyFrameDurations(
                        scene.anims.generateFrameNumbers(textureKey, { start: startStart, end: startEnd }),
                        def.frameDurations,
                        startStart,
                    ),
                    frameRate: def.startFrameRate || def.frameRate || 12,
                    repeat: def.startRepeat !== undefined ? def.startRepeat : 0,
                });
                scene.anims.create({
                    key: textureKey,
                    frames: applyFrameDurations(
                        scene.anims.generateFrameNumbers(textureKey, { start: loopStart, end: loopEnd }),
                        def.frameDurations,
                        loopStart,
                    ),
                    frameRate: def.frameRate || 12,
                    repeat: def.repeat !== undefined ? def.repeat : -1,
                });
            } else {
                const [start, end] = def.frames || [0, Math.max(0, (def.frameCount || 1) - 1)];
                scene.anims.create({
                    key: textureKey,
                    frames: applyFrameDurations(
                        scene.anims.generateFrameNumbers(textureKey, { start, end }),
                        def.frameDurations,
                        start,
                    ),
                    frameRate: def.frameRate || 12,
                    repeat: def.repeat !== undefined ? def.repeat : -1,
                });
            }
        }
    }
}

export function unloadFriendlyUnitAssets(scene, id) {
    const config = CONFIG_BY_ID.get(id);
    if (!config) return;
    for (const animKey of Object.keys(config.animations || {})) {
        const textureKey = friendlyUnitTextureKey(id, animKey);
        if (scene.anims.exists(`${textureKey}_start`)) scene.anims.remove(`${textureKey}_start`);
        if (scene.anims.exists(textureKey)) scene.anims.remove(textureKey);
        if (scene.textures.exists(textureKey)) scene.textures.remove(textureKey);
    }
}

export function estimateFriendlyUnitGpuBytes(id) {
    const config = CONFIG_BY_ID.get(id);
    if (!config) return 0;
    const uniqueSources = new Set();
    let total = 0;
    for (const def of Object.values(config.animations || {})) {
        if (!def?.src || uniqueSources.has(def.src)) continue;
        uniqueSources.add(def.src);
        const cells = Math.max(1, (def.cols || 0) * (def.rows || 0), def.frameCount || 1);
        total += (def.frameWidth || 512) * (def.frameHeight || 512) * cells * 4;
    }
    return total;
}
