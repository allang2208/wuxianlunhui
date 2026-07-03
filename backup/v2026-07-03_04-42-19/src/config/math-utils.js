
export const Easing = {
    easeInQuad(t) { return t * t; },
    easeOutQuad(t) { return 1 - (1 - t) * (1 - t); },
    easeInCubic(t) { return t * t * t; },
    easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
};

export const WEAPON_ANIM = {
    size: 105, holdX: 0, holdY: 0,
    idleAngle: 0, windupAngle: Math.PI / 6, swingAngle: -Math.PI / 6,
    windupMs: 188, swingMs: 250, recoverMs: 438,
};

const MathUtils = {
            distance(x1, y1, x2, y2) { return Math.sqrt((x2-x1)**2 + (y2-y1)**2); },
            angleBetween(x1, y1, x2, y2) { return Math.atan2(y2-y1, x2-x1); },
            pointInSector(px, py, cx, cy, angle, radius, arcAngle) {
                const dist = this.distance(px, py, cx, cy);
                if (dist > radius) return false;
                const pointAngle = this.angleBetween(cx, cy, px, py);
                let diff = Math.abs(pointAngle - angle);
                if (diff > Math.PI) diff = 2 * Math.PI - diff;
                return diff <= arcAngle / 2;
            },
            pointToLineDistance(px, py, x1, y1, x2, y2) {
                const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
                const dot = A * C + B * D, lenSq = C * C + D * D;
                let param = -1;
                if (lenSq !== 0) param = dot / lenSq;
                let xx, yy;
                if (param < 0) { xx = x1; yy = y1; }
                else if (param > 1) { xx = x2; yy = y2; }
                else { xx = x1 + param * C; yy = y1 + param * D; }
                const dx = px - xx, dy = py - yy;
                return Math.sqrt(dx * dx + dy * dy);
            },
            randomRange(min, max) { return min + Math.random() * (max - min); },
            pointInTriangle(px, py, v1x, v1y, v2x, v2y, v3x, v3y) {
                const d1 = (px - v2x) * (v1y - v2y) - (v1x - v2x) * (py - v2y);
                const d2 = (px - v3x) * (v2y - v3y) - (v2x - v3x) * (py - v3y);
                const d3 = (px - v1x) * (v3y - v1y) - (v3x - v1x) * (py - v1y);
                const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
                const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
                return !(hasNeg && hasPos);
            }
        };

export { MathUtils };
