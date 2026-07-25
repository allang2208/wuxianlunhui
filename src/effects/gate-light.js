/**
 * 门闸光束特效（战斗完成开门后）
 * 白光自门外穿过门洞射入战斗房，方向顺门边法线向房内（与地面 30° 等距一致的视觉族）
 * 全部烘焙纹理 + ADD 混合，零运行时开销（不用 Phaser filters）
 */

/** 烘焙地面光斑纹理（椭圆软光） */
function getPoolTexture(scene) {
    if (scene.textures.exists('gate_pool')) return;
    const S = 256;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,252,240,0.75)');
    g.addColorStop(0.5, 'rgba(255,250,230,0.35)');
    g.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    scene.textures.addCanvas('gate_pool', c);
}

/** 确保光斑纹理已创建（门外白区也要用 gate_pool） */
export function ensureGateLightTextures(scene) {
    getPoolTexture(scene);
}

export const GateLight = {
    _group: null,

    /**
     * 生成光照（仅门外独立地块的光斑，照入门内的光束已移除）
     * @param {Phaser.Scene} scene
     * @param {{x,y}} gateCenter 门洞中心（世界）
     * @param {{x,y}} inward 指向房内的单位向量（保留兼容，未使用）
     * @param {{x,y}} [zoneCenter] 门外独立地块中心（光斑位置）
     */
    spawn(scene, gateCenter, inward, zoneCenter) {
        this.destroy();
        ensureGateLightTextures(scene);
        const group = [];
        const zc = zoneCenter || gateCenter;

        // 门外独立地块光斑（周边大面积泛光 + 中心亮核，呼吸脉动）
        const bigPool = scene.add.image(zc.x, zc.y, 'gate_pool');
        bigPool.setDisplaySize(560, 320);
        bigPool.setBlendMode('ADD');
        bigPool.setAlpha(0);
        bigPool.setDepth(zc.y + 1);
        group.push(bigPool);

        const core = scene.add.image(zc.x, zc.y, 'gate_pool');
        core.setDisplaySize(220, 200);
        core.setBlendMode('ADD');
        core.setAlpha(0);
        core.setDepth(zc.y + 2);
        group.push(core);

        // 淡入 + 呼吸
        scene.tweens.add({ targets: [bigPool, core], alpha: (t) => (t === core ? 1 : 0.9), duration: 1200, ease: 'Sine.easeOut' });
        scene.tweens.add({ targets: bigPool, scaleX: '+=0.06', scaleY: '+=0.06', yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.easeInOut', delay: 1200 });

        this._group = group;
        return group;
    },

    destroy() {
        if (this._group) {
            for (const s of this._group) {
                if (s && s.scene) {
                    s.scene.tweens.killTweensOf(s);
                    s.destroy();
                }
            }
            this._group = null;
        }
    },
};
