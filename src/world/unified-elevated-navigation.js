function patchKind(surface) {
    if (!surface) return null;
    if (surface.elevatedPatch) return surface.elevatedPatch;
    if (surface.handoffDown || surface.connector) return 'wall-stair-bridge';
    if (surface.sharedSeam) return 'stair-seam';
    if (surface.kind === 'stairs') return 'stair';
    if (surface.kind === 'wall_walk') return 'wall';
    return 'elevated';
}

/** 统一收集墙顶、楼梯、共享缝与墙梯接口候选。 */
export function createUnifiedElevatedNavigation(options) {
    const {
        chooseCandidate,
        maxPlatformDistance = 240,
    } = options;

    const query = (unit, x, y, platforms, wallSurfaceResolver) => {
        const candidates = [];
        const seenSharedSeams = new Set();
        for (const platform of platforms || []) {
            if (!platform?.active) continue;
            if (platform._isWallStaircase) {
                const nearby = (platform.segments || []).some((segment) =>
                    Math.hypot(segment.x - x, segment.y - y) <= maxPlatformDistance);
                if (!nearby && (!platform.wall
                    || Math.hypot(platform.wall.x - x, platform.wall.y - y)
                        > maxPlatformDistance)) continue;
            }
            let surface = null;
            if (typeof platform.surfaceAt === 'function') {
                surface = platform.surfaceAt(x, y, unit);
            } else if (typeof platform.isOnPlatform === 'function'
                && platform.isOnPlatform(x, y)) {
                surface = { kind: 'deck', z: platform.platformHeight || 0 };
            }
            if (surface) {
                if (surface.sharedSeamRef) {
                    if (!seenSharedSeams.has(surface.sharedSeamRef)) {
                        seenSharedSeams.add(surface.sharedSeamRef);
                        surface.elevatedPatch = patchKind(surface);
                        candidates.push({
                            surface,
                            staircase: surface.staircase || platform,
                        });
                    }
                } else {
                    surface.elevatedPatch = patchKind(surface);
                    candidates.push({
                        surface,
                        staircase: surface.staircase || platform,
                    });
                }
            }
            const bridge = platform.navigationBridgeAt?.(x, y, unit);
            if (bridge) {
                bridge.elevatedPatch = patchKind(bridge);
                candidates.push({
                    surface: bridge,
                    staircase: bridge.staircase || platform,
                });
            }
        }
        const wallSurface = wallSurfaceResolver?.(x, y);
        if (wallSurface) {
            wallSurface.elevatedPatch = patchKind(wallSurface);
            candidates.push({ surface: wallSurface, staircase: null });
        }
        const selected = chooseCandidate(unit, candidates);
        return selected
            ? {
                surface: selected.surface,
                staircase: selected.staircase,
                candidateCount: candidates.length,
            }
            : { surface: null, staircase: null, candidateCount: 0 };
    };

    const commitFlags = (unit, surface) => {
        const patch = patchKind(surface);
        unit._elevatedNavigationActive = !!surface
            && (surface.kind === 'stairs' || surface.kind === 'wall_walk');
        unit._elevatedNavigationPatch = patch;
        unit._elevatedNavigationBridge = patch === 'wall-stair-bridge'
            || patch === 'stair-seam';
        unit._elevatedNavigationComponent = unit._elevatedNavigationActive
            ? (surface?.walls || []).map((wall) => wall?.id).filter(Boolean).sort().join('|')
            : null;
    };

    return { query, commitFlags };
}
