import spriteOffsetsData from '../../data/sprite-offsets.json';

export const SPRITE_OFFSETS = spriteOffsetsData || {};

export function getSpriteFrameOffset(animKey, frameIndex) {
    const byFrame = SPRITE_OFFSETS[animKey];
    if (!byFrame) return null;
    return byFrame[frameIndex] ?? null;
}
