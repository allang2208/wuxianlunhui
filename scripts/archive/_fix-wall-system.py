# -*- coding: utf-8 -*-
"""一次性修改 wall-system.js（混合行尾文件，Edit 工具无法处理）。

改动（世界-122 怪物卡死修复 ①⑤）：
1. 新增 getObstacleFootprintRect 共享推导 + _addPieceCollision 障碍物分支改用它
2. resolve 增加矩形障碍切向滑动（散布树 footprint 等）
3. 新增 _nearestBlockingRect 辅助
"""
import re, sys

P = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\src\world\wall-system.js'
src = open(P, encoding='utf-8').read()

# ---------- 1. 共享 footprint 推导 + _addPieceCollision 重构 ----------
old_branch = """        if (geo && geo.category === 'obstacle' && geo.foot) {
            const sx = Math.abs(p.scaleX ?? 1), sy = Math.abs(p.scaleY ?? p.scaleX ?? 1);
            const fw = geo.foot.w * sx, fd = geo.foot.d * sy;
            // 数据兜底：负/零缩放或异常 foot 不生成退化碰撞（0 厚墙/反向墙）
            if (!(fw > 0) || !(fd > 0)) return;
            const offX = (geo.foot.offsetX || 0) * sx, offY = (geo.foot.offsetY || 0) * sy;
            const bottomY = p.y + (geo.h * sy) / 2 + offY;
            // 旋转：footprint 矩形随 p.rotation 旋转，碰撞盒取旋转后 AABB
            // （半宽/深按 |cos|/|sin| 展开；未旋转退化为原矩形）
            const rot = p.rotation || 0;
            let hw = fw / 2, hd = fd / 2;
            if (rot) {
                const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
                const nw = hw * c + hd * s;
                hd = hw * s + hd * c;
                hw = nw;
            }
            const cx = p.x + offX, cy = bottomY - fd / 2;
            this.walls.push({
                x: cx - hw,
                y: cy - hd,
                w: hw * 2, h: hd * 2,
                height: 60, noVisual: true, _iso: true, _obstacle: true,
            });
            return;
        }"""
old_branch_crlf = old_branch.replace('\n', '\r\n')

new_branch = """        if (geo && geo.category === 'obstacle' && geo.foot) {
            const rect = this.getObstacleFootprintRect(p);
            if (!rect) return;
            this.walls.push({
                ...rect,
                height: 60, noVisual: true, _iso: true, _obstacle: true,
            });
            return;
        }"""

helper = """    /** 障碍物 footprint 矩形（世界坐标）：碰撞注册与场景散布排除带共用同一推导口径，禁止各自实现 */
    getObstacleFootprintRect(p) {
        const geo = this._geoForTex(p.tex);
        if (!geo || geo.tex === ISO_WALL_GEO.torch.tex) return null;
        if (geo.category !== 'obstacle' || !geo.foot) return null;
        const sx = Math.abs(p.scaleX ?? 1), sy = Math.abs(p.scaleY ?? p.scaleX ?? 1);
        const fw = geo.foot.w * sx, fd = geo.foot.d * sy;
        // 数据兜底：负/零缩放或异常 foot 返回 null（0 厚墙/反向墙）
        if (!(fw > 0) || !(fd > 0)) return null;
        const offX = (geo.foot.offsetX || 0) * sx, offY = (geo.foot.offsetY || 0) * sy;
        const bottomY = p.y + (geo.h * sy) / 2 + offY;
        // 旋转：footprint 矩形随 p.rotation 旋转，碰撞盒取旋转后 AABB
        // （半宽/深按 |cos|/|sin| 展开；未旋转退化为原矩形）
        const rot = p.rotation || 0;
        let hw = fw / 2, hd = fd / 2;
        if (rot) {
            const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
            const nw = hw * c + hd * s;
            hd = hw * s + hd * c;
            hw = nw;
        }
        const cx = p.x + offX, cy = bottomY - fd / 2;
        return { x: cx - hw, y: cy - hd, w: hw * 2, h: hd * 2 };
    },
"""
helper_crlf = helper.replace('\n', '\r\n')

anchor = "    /** 单件碰撞：底边线段"
anchor_crlf_variants = [anchor, anchor.replace('\n', '\r\n')]

done1 = False
if old_branch_crlf in src:
    src = src.replace(old_branch_crlf, new_branch.replace('\n', '\r\n'), 1)
    done1 = True
elif old_branch in src:
    src = src.replace(old_branch, new_branch, 1)
    done1 = True

if not done1:
    print('FAIL: obstacle branch not found'); sys.exit(1)

# 插入 helper（锚定 _addPieceCollision 的 jsdoc 行）
ins_done = False
for a in anchor_crlf_variants:
    idx = src.find(a)
    if idx >= 0:
        src = src[:idx] + (helper_crlf if '\r\n' in src[idx-2:idx] or '\r\n' in src[idx:idx+200] else helper) + src[idx:]
        ins_done = True
        break
if not ins_done:
    print('FAIL: anchor for helper not found'); sys.exit(1)

# ---------- 2+3. resolve 矩形切向滑动 + _nearestBlockingRect ----------
old_resolve_part = """        if (this.canMoveTo(nx, y, r) && !this.blocked(x, y, nx, y)) return { x: nx, y };
        if (this.canMoveTo(x, ny, r) && !this.blocked(x, y, x, ny)) return { x, y: ny };
        // [OPTIMIZE] 标准滑动失败后，尝试沿移动方向逐步缩减步长"""
new_resolve_part = """        if (this.canMoveTo(nx, y, r) && !this.blocked(x, y, nx, y)) return { x: nx, y };
        if (this.canMoveTo(x, ny, r) && !this.blocked(x, y, x, ny)) return { x, y: ny };
        // 矩形障碍（散布树 footprint 等）切向滑动：对最近阻挡矩形取贴面方向投影，
        // 与 iso 段同口径；两轴分解都堵死（L/V 形树兜）时沿矩形边滑出
        const bRect = this._nearestBlockingRect(nx, ny, r);
        if (bRect) {
            const rdx = nx - x, rdy = ny - y;
            // 实体相对矩形最近点的法线方向
            const px = Math.max(bRect.x, Math.min(x, bRect.x + bRect.w));
            const py = Math.max(bRect.y, Math.min(y, bRect.y + bRect.h));
            let fnx = x - px, fny = y - py;
            const fnl = Math.hypot(fnx, fny);
            let tx, ty;
            if (fnl > 1e-6) { tx = -fny / fnl; ty = fnx / fnl; }
            else { tx = -rdy; ty = rdx; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl; }
            // 取与移动方向同向的切向（不反向调头），速度不超意图
            if (rdx * tx + rdy * ty < 0) { tx = -tx; ty = -ty; }
            const tMag = Math.abs(rdx * tx + rdy * ty);
            for (const ratio of [1, 0.5, 0.25]) {
                const sx = x + tx * tMag * ratio, sy = y + ty * tMag * ratio;
                if (this.canMoveTo(sx, sy, r) && !this.blocked(x, y, sx, sy)) {
                    return { x: sx, y: sy };
                }
            }
        }
        // [OPTIMIZE] 标准滑动失败后，尝试沿移动方向逐步缩减步长"""

rect_helper = """    /** 找离目标点最近的阻挡矩形墙（散布树 footprint 等；圆心到矩形距离 < r + 容差） */
    _nearestBlockingRect(nx, ny, r) {
        let best = null, bestD = Infinity;
        for (const w of this.walls) {
            if (!w) continue;
            const cx = Math.max(w.x, Math.min(nx, w.x + w.w));
            const cy = Math.max(w.y, Math.min(ny, w.y + w.h));
            const d = Math.hypot(nx - cx, ny - cy);
            if (d < r + 4 && d < bestD) { bestD = d; best = w; }
        }
        return best;
    },
"""

done2 = False
for variant in [old_resolve_part.replace('\n', '\r\n'), old_resolve_part]:
    if variant in src:
        crlf = '\r\n' in variant
        src = src.replace(variant, new_resolve_part.replace('\n', '\r\n') if crlf else new_resolve_part, 1)
        done2 = True
        break
if not done2:
    print('FAIL: resolve axis-slide block not found'); sys.exit(1)

# _nearestBlockingRect 插在 _nearestBlockingSeg 之后（锚定 lineCircle 定义）
anchor2_variants = ["    lineCircle(x1, y1, x2, y2, cx, cy, r) {\r", "    lineCircle(x1, y1, x2, y2, cx, cy, r) {"]
done3 = False
for a in anchor2_variants:
    idx = src.find(a)
    if idx >= 0:
        use_crlf = '\r' in a
        src = src[:idx] + (rect_helper.replace('\n', '\r\n') if use_crlf else rect_helper) + src[idx:]
        done3 = True
        break
if not done3:
    print('FAIL: lineCircle anchor not found'); sys.exit(1)

open(P, 'w', encoding='utf-8', newline='').write(src)
print('OK: wall-system.js 三处改动完成')
