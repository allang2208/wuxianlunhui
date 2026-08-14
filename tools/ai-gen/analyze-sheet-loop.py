"""分析动作 sheet 的帧差异，定位循环周期与起步/循环分界。
对每帧提取采样二值轮廓（alpha 阈值），计算：
  - 相邻帧差异（帧间变化）
  - 指定帧与其它帧的差异（找循环首尾配对，如 frame i ≈ frame j 则 i..j 可循环）
  - running 的起步段（帧间差异突变的段）
用法：python analyze-sheet-loop.py <sheet.png> <frameW> <frameH> [--pair 0]
"""
import sys
from PIL import Image


def frame_profile(img, fx, fy, fw, fh, step=8):
    """采样帧的非透明轮廓：返回 (二值数组, 质心x, 质心y, 内容宽, 内容高)"""
    vals = []
    minx, maxx, miny, maxy = fw, -1, fh, -1
    cx_sum = cy_sum = cnt = 0
    for y in range(0, fh, step):
        row = []
        for x in range(0, fw, step):
            a = img.getpixel((fx + x, fy + y))[3]
            on = a > 40
            row.append(on)
            if on:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
                cx_sum += x; cy_sum += y; cnt += 1
        vals.append(row)
    return vals, (cx_sum / cnt if cnt else 0, cy_sum / cnt if cnt else 0), (maxx - minx + 1, maxy - miny + 1)


def diff(a, b):
    """二值轮廓差异率 0..1"""
    ra = sum(sum(r) for r in a)
    rb = sum(sum(r) for r in b)
    if ra == 0 and rb == 0: return 0
    diffc = sum(1 for y in range(len(a)) for x in range(len(a[0])) if a[y][x] != b[y][x])
    return diffc / (len(a) * len(a[0]))


def main():
    path = sys.argv[1]
    fw = int(sys.argv[2]); fh = int(sys.argv[3])
    img = Image.open(path).convert("RGBA")
    cols = img.width // fw; rows = img.height // fh
    n = cols * rows
    print(f"{path}: {img.width}x{img.height} = {cols}x{rows} 帧 (共{n})")
    profiles = []
    for i in range(n):
        fx = (i % cols) * fw; fy = (i // cols) * fh
        profiles.append(frame_profile(img, fx, fy, fw, fh))
    # 相邻帧差异
    print("\n相邻帧差异:")
    for i in range(1, n):
        d = diff(profiles[i-1][0], profiles[i][0])
        print(f"  {i-1:2d}->{i:2d}: {d:.3f}  (质心 {round(profiles[i][1][0])},{round(profiles[i][1][1])})")
    # 指定帧与其它帧的差异（循环配对）
    if "--pair" in sys.argv:
        p = int(sys.argv[sys.argv.index("--pair") + 1])
        print(f"\n帧 {p} 与其它帧差异:")
        for j in range(n):
            if j == p: continue
            d = diff(profiles[p][0], profiles[j][0])
            print(f"  {p} vs {j}: {d:.3f}")
    # 首尾差异
    print(f"\n首帧(0) vs 末帧({n-1}) 差异: {diff(profiles[0][0], profiles[n-1][0]):.3f}")


if __name__ == "__main__":
    main()
