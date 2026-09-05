#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    registerStructureShadowCasterManifest,
    resolveStructureShadowCaster,
} from '../src/world/structure-shadow-caster.js';

const actualManifest = JSON.parse(fs.readFileSync(
    new URL('../data/structure-shadow-casters.json', import.meta.url),
    'utf8'
));
const producerConfig = JSON.parse(fs.readFileSync(
    new URL('../data/producer-buildings.json', import.meta.url),
    'utf8'
));

const syntheticManifest = {
    algorithmVersion: 2,
    entries: [{
        id: 'synthetic_tower',
        textureKey: 'synthetic_tower',
        displayWidth: 200,
        displayHeight: 200,
        sourceKind: 'semantic_shadow_proxy_v2',
        contactPolygon: [[-10, 0], [10, 0], [0, -12]],
        parts: [
            {
                id: 'hall',
                polygon: [[-10, 0], [10, 0], [0, -12]],
                baseRatio: 0,
                topRatio: 0.5,
            },
            {
                id: 'column',
                polygon: [[8, -2], [12, -4], [9, -7]],
                baseRatio: 0.5,
                topRatio: 1,
            },
        ],
    }],
};

const sprite = {
    x: 100,
    y: 200,
    // 模拟严格 visualFootprint 在运行时对 Sprite 做非等比微调；清单身份仍应
    // 读取当前等级配置的原始画布尺寸，而不是这个最终显示尺寸。
    displayWidth: 206,
    displayHeight: 185,
    flipX: false,
    texture: { key: 'synthetic_tower' },
    frame: { name: '__BASE' },
};

try {
    assert.equal(registerStructureShadowCasterManifest(syntheticManifest), 1);

    const entity = {
        x: 100,
        y: 200,
        spriteCfg: {
            size: 200,
            sizeH: 200,
            // 旧克隆器会物化这两个空数组；它们不得吞掉语义代理。
            shadowCaster: { height: 120, contactPolygon: [], parts: [] },
        },
    };
    const caster = resolveStructureShadowCaster(null, entity, sprite);
    assert.equal(caster.source, 'manifest_semantic_shadow_proxy_v2');
    assert.equal(caster.parts.length, 2);
    assert.deepEqual(
        caster.parts.map((part) => [part.id, part.baseZ, part.topZ]),
        [['hall', 0, 60], ['column', 60, 120]]
    );
    assert.deepEqual(caster.contactVertices[0], { x: 90, y: 200 });

    const mirrored = resolveStructureShadowCaster(
        null,
        { ...entity, _facingLeft: true },
        sprite
    );
    assert.deepEqual(mirrored.contactVertices[0], { x: 110, y: 200 });
    assert.equal(mirrored.parts[1].vertices[0].x, 92);

    const explicit = resolveStructureShadowCaster(null, {
        ...entity,
        spriteCfg: {
            size: 200,
            sizeH: 200,
            shadowCaster: {
                height: 120,
                contactPolygon: [[-3, 0], [3, 0], [0, -4]],
            },
        },
    }, sprite);
    assert.equal(explicit.source, 'config');
    assert.deepEqual(explicit.contactVertices[0], { x: 97, y: 200 });

    const mismatchedEntity = {
        ...entity,
        spriteCfg: { ...entity.spriteCfg, size: 250 },
    };
    assert.equal(resolveStructureShadowCaster(null, mismatchedEntity, sprite), null);
    const noConfiguredDimensions = {
        x: 100,
        y: 200,
        spriteCfg: { shadowCaster: { height: 120 } },
    };
    assert.equal(resolveStructureShadowCaster(null, noConfiguredDimensions, {
        ...sprite,
        displayWidth: 200,
        displayHeight: 200,
    })?.parts.length, 2);
    assert.equal(resolveStructureShadowCaster(null, {
        ...entity,
        shadowCaster: { enabled: false },
    }, sprite), null);

    const identities = new Set();
    for (const entry of actualManifest.entries || []) {
        const identity = `${entry.textureKey}:${entry.displayWidth}:${entry.displayHeight}`;
        assert(!identities.has(identity), `duplicate manifest entry: ${identity}`);
        identities.add(identity);
        assert(entry.contactPolygon.length >= 3, `invalid contact polygon: ${entry.id}`);
    }
    for (const id of ['oil_power_plant', 'cannery', 'trading_company']) {
        const entry = actualManifest.entries.find((candidate) => candidate.id === id);
        assert.equal(entry?.sourceKind, 'semantic_shadow_proxy_v2', `${id} semantic proxy missing`);
        assert(entry.parts.length >= 2, `${id} should retain multiple height parts`);
    }

    registerStructureShadowCasterManifest(actualManifest);
    for (const id of ['oil_power_plant', 'cannery', 'trading_company']) {
        const entry = actualManifest.entries.find((candidate) => candidate.id === id);
        const config = producerConfig[id];
        const runtimeCaster = resolveStructureShadowCaster(null, {
            id,
            x: 0,
            y: 0,
            spriteCfg: {
                size: config.displayW,
                sizeH: config.displayH,
                shadowCaster: {
                    ...config.shadowCaster,
                    contactPolygon: [],
                    parts: [],
                },
            },
        }, {
            texture: { key: config.tex },
            // 模拟严格 visualFootprint 对正式 Sprite 的非等比拟合结果。
            displayWidth: config.displayW * 1.01,
            displayHeight: config.displayH * 0.93,
            flipX: false,
        });
        assert.equal(runtimeCaster?.source, 'manifest_semantic_shadow_proxy_v2',
            `${id} should match by configured dimensions`);
        assert.deepEqual(runtimeCaster.parts.map((part) => part.id),
            entry.parts.map((part) => part.id), `${id} semantic parts should survive empty config arrays`);
    }
    console.log('building shadow caster runtime: OK (manifest, parts, mirror, precedence, guards)');
} finally {
    registerStructureShadowCasterManifest(actualManifest);
}
