/** 纹理键存在不代表帧仍可渲染，尤其是失败重载或同 key 纹理被替换之后。 */
export function isTextureReady(scene, key) {
    if (!key || !scene?.textures?.exists(key)) return false;
    const texture = scene.textures.get(key);
    const source = texture?.source?.[0];
    return !!source?.image && source.width > 0 && source.height > 0
        && Number.isFinite(source.resolution) && source.resolution > 0;
}

export function isSpriteFrameReady(scene, sprite) {
    const frame = sprite?.frame;
    const key = sprite?.texture?.key;
    return isTextureReady(scene, key)
        && sprite.texture === scene.textures.get(key)
        && frame?.texture === sprite.texture
        && frame.source === sprite.texture.source[frame.sourceIndex]
        && !!frame.source;
}

export function animationUsesCurrentTextures(scene, animation) {
    return !!animation?.frames?.length && animation.frames.every(({ textureKey, frame }) => {
        if (!isTextureReady(scene, textureKey)) return false;
        const texture = scene.textures.get(textureKey);
        return frame?.texture === texture && !!frame.source
            && frame.source === texture.source[frame.sourceIndex];
    });
}

export function loadedTextureBytes(scene, key) {
    if (!isTextureReady(scene, key)) return 0;
    return scene.textures.get(key).source.reduce((sum, source) => {
        const image = source?.image;
        const width = Number(image?.naturalWidth || image?.width || source?.width) || 0;
        const height = Number(image?.naturalHeight || image?.height || source?.height) || 0;
        return sum + width * height * 4;
    }, 0);
}

export function getRenderObjects(scene) {
    const objects = [];
    const seen = new Set();
    const visit = (object) => {
        if (!object || seen.has(object)) return;
        seen.add(object);
        objects.push(object);
        if (Array.isArray(object.list)) object.list.forEach(visit);
    };
    for (const current of scene?.game?.scene?.scenes || [scene]) {
        for (const child of current?.children?.list || []) visit(child);
    }
    return objects;
}

export function detachSpriteAnimation(sprite) {
    const state = sprite?.anims;
    if (!state) return;
    // stop() 会自动播放 nextAnim；修复坏帧/释放预览时必须先清空该队列。
    state.nextAnim = null;
    state.nextAnimsQueue.length = 0;
    state.stop();
    state.isPlaying = false;
    state.currentAnim = null;
    state.currentFrame = null;
}

export function removeAnimationSafely(scene, key) {
    if (!scene?.anims?.exists(key)) return;
    for (const sprite of getRenderObjects(scene)) {
        if (sprite.anims?.currentAnim?.key !== key) continue;
        // Phaser 的 REMOVE_ANIMATION 事件会把正在播放者拉回首帧，必须先断开。
        detachSpriteAnimation(sprite);
        if (!isSpriteFrameReady(scene, sprite) && sprite.setTexture) sprite.setTexture('__WHITE');
    }
    scene.anims.remove(key);
}
