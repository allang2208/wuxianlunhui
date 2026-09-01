"""Frozen packing helpers from the existing horror pipeline; no actor dependency."""
import math
import numpy as np
from PIL import Image

def layout(count, width, height):
    options = []
    for cols in range(1, min(count, 4096//width)+1):
        rows = math.ceil(count/cols)
        if rows*height <= 4096:
            options.append(((cols*rows-count, abs(math.log((cols*width)/(rows*height)))), cols, rows))
    if not options:
        raise RuntimeError("No single-sheet layout under 4096")
    _, cols, rows = min(options)
    return cols, rows


def pack(cells, cols, path):
    height, width = cells[0].shape[:2]
    sheet = Image.new("RGBA", (cols*width, math.ceil(len(cells)/cols)*height))
    for index, cell in enumerate(cells):
        sheet.paste(Image.fromarray(cell), (index%cols*width, index//cols*height))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
    return sheet.size


def checker(cell):
    height, width = cell.shape[:2]
    yy, xx = np.indices((height, width))
    grid = (xx//12 + yy//12) % 2
    rgb = np.where(grid[..., None] == 0, np.array([52, 56, 62]), np.array([66, 70, 77])).astype(np.uint8)
    bg = Image.fromarray(rgb).convert("RGBA")
    bg.alpha_composite(Image.fromarray(cell))
    return bg.convert("RGB")


def gif_durations(milliseconds):
    points = [0]
    total = 0
    for value in milliseconds:
        total += value
        points.append(round(total/10)*10)
    return [b-a for a,b in zip(points, points[1:])]


def save_preview(cells, milliseconds, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    # GIF players may stretch 0/10ms frames. Sample the final clock at ~25fps;
    # preserve cumulative total duration without changing formal sprite timing.
    total=sum(milliseconds)
    count=max(1,round(total/40))
    clock=np.cumsum(milliseconds)
    indices=np.searchsorted(clock,np.arange(count)*total/count,side='right')
    frames = [checker(cells[min(int(i),len(cells)-1)]) for i in indices]
    durations=gif_durations([total/count]*count)
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=durations, loop=0, disposal=2, optimize=False)
    return sum(durations)
