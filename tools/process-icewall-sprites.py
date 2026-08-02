# 冰墙 AI 素材处理（2026-08-02）
# 即梦出图（纯黑背景 + 右下角水印）→ 透明底游戏素材：
#   1) 边缘洪泛抠黑底（保留冰体内部深色区域）
#   2) 连通域分析只保留最大组件（自动去掉孤立的水印/噪点）
#   3) alpha 边缘轻微羽化
#   4) 裁剪到内容包围盒 + 缩放到统一高度
# 用法: .venv-sprites/Scripts/python.exe tools/process-icewall-sprites.py
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

SRC_DIR = Path('assets/effects/icewall')
TARGET_H = 320          # 输出统一高度（游戏内显示 48x64 ~ 84，足够）
BLACK_TH = 24           # 黑底阈值（实测 5 张源图在 22~35 有天然亮度谷，缝隙/背景全 <22）
FEATHER = 1.2           # alpha 羽化半径（高斯 sigma）

def process(src: Path, dst: Path):
    img = Image.open(src).convert('RGB')
    a = np.asarray(img).astype(np.uint8)
    lum = a.max(axis=2)  # 近黑判定用最大通道（抗偏色）

    # 1) 全图近黑抠除：黑底 + 晶柱缝隙里的黑色区域一起透明
    #    （缝隙透明后露出游戏地面，比黑三角更真实；暗色冰面亮度 >35 不受影响）
    background = lum < BLACK_TH

    # 2) 前景连通域，只保留最大组件（主体 + 底座相连；水印是孤立小块）
    foreground = ~background
    labels, n = ndimage.label(foreground)
    if n == 0:
        raise RuntimeError(f'{src}: no foreground found')
    sizes = ndimage.sum(foreground, labels, range(1, n + 1))
    keep = 1 + int(np.argmax(sizes))
    mask = labels == keep

    # 3) 羽化 alpha 边缘
    alpha = ndimage.gaussian_filter(mask.astype(np.float32), sigma=FEATHER)
    alpha = np.clip(alpha * 255, 0, 255).astype(np.uint8)

    # 4) 裁剪包围盒（按 alpha>8 的区域），四边留 4px
    ys, xs = np.where(alpha > 8)
    y0, y1 = max(0, ys.min() - 4), min(alpha.shape[0], ys.max() + 5)
    x0, x1 = max(0, xs.min() - 4), min(alpha.shape[1], xs.max() + 5)
    rgba = np.dstack([a, alpha])[y0:y1, x0:x1]

    out = Image.fromarray(rgba, 'RGBA')
    scale = TARGET_H / out.height
    out = out.resize((max(1, round(out.width * scale)), TARGET_H), Image.LANCZOS)
    out.save(dst)
    return out.size, float(sizes.max()) / foreground.sum()

if __name__ == '__main__':
    for i in range(5):
        src = SRC_DIR / f'src_{i}.png'
        dst = SRC_DIR / f'segment_{i}.png'
        size, purity = process(src, dst)
        print(f'{dst}: {size[0]}x{size[1]} 主体占比 {purity:.2%}')
