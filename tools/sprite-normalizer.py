from PIL import Image
import os, json, argparse, sys
from pathlib import Path


def get_frame_bounds(img, frame_w, frame_h, col, row):
    """获取单帧中实际内容的边界框"""
    left = col * frame_w
    top = row * frame_h
    right = left + frame_w
    bottom = top + frame_h

    frame = img.crop((left, top, right, bottom))
    if frame.mode != 'RGBA':
        frame = frame.convert('RGBA')
    pixels = frame.load()

    min_x, max_x = frame_w, -1
    min_y, max_y = frame_h, -1
    has_content = False

    for y in range(frame_h):
        for x in range(frame_w):
            alpha = pixels[x, y][3]
            if alpha > 10:
                has_content = True
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)

    if not has_content:
        return None

    return {
        "left": min_x, "top": min_y,
        "right": max_x + 1, "bottom": max_y + 1,
        "width": max_x - min_x + 1, "height": max_y - min_y + 1,
        "center_x": (min_x + max_x + 1) / 2.0,
        "center_y": (min_y + max_y + 1) / 2.0,
    }


def analyze_sprite_sheet(path, frame_w, frame_h, cols, rows):
    """分析整个精灵图，返回每帧信息和统计"""
    img = Image.open(path)
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    frames = []
    for r in range(rows):
        for c in range(cols):
            info = get_frame_bounds(img, frame_w, frame_h, c, r)
            if info:
                frames.append(info)

    if not frames:
        return None

    avg_width = sum(f["width"] for f in frames) / len(frames)
    avg_height = sum(f["height"] for f in frames) / len(frames)
    avg_center_x = sum(f["center_x"] for f in frames) / len(frames)
    avg_center_y = sum(f["center_y"] for f in frames) / len(frames)

    return {
        "file": path,
        "size": img.size,
        "frames": frames,
        "avg_width": avg_width,
        "avg_height": avg_height,
        "avg_center_x": avg_center_x,
        "avg_center_y": avg_center_y,
    }


def normalize_sprite_sheet(src_path, dst_path, frame_w, frame_h, cols, rows,
                           target_content_w, target_content_h,
                           target_center_x, target_center_y,
                           align_mode='center'):
    """标准化单个精灵图：缩放+平移使内容一致

    align_mode:
      - center: 内容中心对齐到 target_center（默认，适合原地动画）
      - bottom: 内容底部对齐到统一位置（适合脚着地的动画，如走路、嚎叫）
      - top:    内容顶部对齐到统一位置（适合从上往下看的动画）
    """
    img = Image.open(src_path)
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    # 先分析所有帧，获取对齐基准
    all_frames = []
    for r in range(rows):
        for c in range(cols):
            bounds = get_frame_bounds(img, frame_w, frame_h, c, r)
            if bounds:
                all_frames.append(bounds)

    if not all_frames:
        return None

    # 计算对齐基准
    if align_mode == 'bottom':
        # 所有帧底部对齐到最靠下的底部
        target_align_y = max(f['bottom'] for f in all_frames)
    elif align_mode == 'top':
        target_align_y = min(f['top'] for f in all_frames)
    else:  # center
        target_align_y = None  # 使用 target_center_y

    # 创建新画布
    new_img = Image.new('RGBA', (frame_w * cols, frame_h * rows), (0, 0, 0, 0))

    for r in range(rows):
        for c in range(cols):
            bounds = get_frame_bounds(img, frame_w, frame_h, c, r)
            if not bounds:
                continue

            # 裁剪原始帧内容
            left = c * frame_w + bounds["left"]
            top = r * frame_h + bounds["top"]
            right = left + bounds["width"]
            bottom = top + bounds["height"]
            content = img.crop((left, top, right, bottom))

            # 计算缩放比例（保持宽高比，取较小值，fit模式）
            scale_x = target_content_w / bounds["width"]
            scale_y = target_content_h / bounds["height"]
            scale = min(scale_x, scale_y)

            # 缩放内容
            new_w = int(round(bounds["width"] * scale))
            new_h = int(round(bounds["height"] * scale))
            if new_w > 0 and new_h > 0:
                content_scaled = content.resize((new_w, new_h), Image.LANCZOS)
            else:
                continue

            # 根据对齐模式计算目标位置
            if align_mode == 'bottom':
                # 底部对齐：内容底部对齐到 target_align_y
                dest_x = int(round(target_center_x - new_w / 2.0))
                dest_y = int(round(target_align_y - new_h))
            elif align_mode == 'top':
                # 顶部对齐：内容顶部对齐到 target_align_y
                dest_x = int(round(target_center_x - new_w / 2.0))
                dest_y = int(round(target_align_y))
            else:  # center
                dest_x = int(round(target_center_x - new_w / 2.0))
                dest_y = int(round(target_center_y - new_h / 2.0))

            # 在目标帧中的绝对位置
            frame_offset_x = c * frame_w + dest_x
            frame_offset_y = r * frame_h + dest_y

            # 粘贴（使用 alpha 作为 mask）
            new_img.paste(content_scaled, (frame_offset_x, frame_offset_y), content_scaled)

    # 确保图片尺寸正确（spritesheet 必须是 frame 的整数倍）
    expected_w = frame_w * cols
    expected_h = frame_h * rows
    if new_img.size != (expected_w, expected_h):
        fixed = Image.new('RGBA', (expected_w, expected_h), (0, 0, 0, 0))
        fixed.paste(new_img, (0, 0))
        new_img = fixed

    new_img.save(dst_path, format='PNG')
    return new_img.size


def main():
    parser = argparse.ArgumentParser(description='Sprite Sheet Normalizer - 统一精灵图内容大小和位置')
    parser.add_argument('--input', '-i', nargs='+', required=True, help='输入精灵图文件（可多个）')
    parser.add_argument('--output', '-o', required=True, help='输出目录')
    parser.add_argument('--frame-width', type=int, required=True, help='单帧宽度')
    parser.add_argument('--frame-height', type=int, required=True, help='单帧高度')
    parser.add_argument('--cols', type=int, required=True, help='每行列数')
    parser.add_argument('--rows', type=int, required=True, help='总行数')
    parser.add_argument('--mode', choices=['fit', 'fill'], default='fit',
                        help='fit=缩放适应到统一内容大小（保持比例，不裁剪）; fill=缩放到填满统一内容大小（可能变形）')
    parser.add_argument('--align-mode', choices=['center', 'bottom', 'top'], default='center',
                        help='center=内容中心对齐（默认，适合原地动画）; bottom=内容底部对齐（适合脚着地的动画，如走路/嚎叫）; top=内容顶部对齐（适合从上往下看的动画）')
    parser.add_argument('--target-content-w', type=float, help='目标内容宽度（默认取所有输入中的最大值）')
    parser.add_argument('--target-content-h', type=float, help='目标内容高度（默认取所有输入中的最大值）')
    parser.add_argument('--target-center-x', type=float, help='目标内容中心 X（默认取帧中心）')
    parser.add_argument('--target-center-y', type=float, help='目标内容中心 Y（默认取帧中心）')
    parser.add_argument('--report', action='store_true', help='只输出分析报告，不生成文件')
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    # 第一步：分析所有输入精灵图
    analyses = []
    for path in args.input:
        if not os.path.exists(path):
            print(f'[WARN] 文件不存在: {path}', file=sys.stderr)
            continue
        info = analyze_sprite_sheet(path, args.frame_width, args.frame_height, args.cols, args.rows)
        if info:
            analyses.append(info)
            print(f'[分析] {os.path.basename(path)}: 内容大小 {info["avg_width"]:.1f}x{info["avg_height"]:.1f}, 中心 ({info["avg_center_x"]:.1f}, {info["avg_center_y"]:.1f})')

    if not analyses:
        print('[ERROR] 没有有效的精灵图', file=sys.stderr)
        sys.exit(1)

    # 计算目标参数
    target_w = args.target_content_w if args.target_content_w else max(a['avg_width'] for a in analyses)
    target_h = args.target_content_h if args.target_content_h else max(a['avg_height'] for a in analyses)
    target_cx = args.target_center_x if args.target_center_x else args.frame_width / 2.0
    target_cy = args.target_center_y if args.target_center_y else args.frame_height / 2.0

    print(f'[统一] 目标内容大小: {target_w:.1f}x{target_h:.1f}, 目标中心: ({target_cx:.1f}, {target_cy:.1f}), 对齐模式: {args.align_mode}')

    if args.report:
        report_path = os.path.join(args.output, 'sprite-normalize-report.json')
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump({
                'target': {'width': target_w, 'height': target_h, 'center_x': target_cx, 'center_y': target_cy},
                'sprites': analyses
            }, f, indent=2, ensure_ascii=False)
        print(f'[报告] 已保存: {report_path}')
        return

    # 第二步：生成标准化精灵图
    for info in analyses:
        src = info['file']
        dst = os.path.join(args.output, os.path.basename(src))
        new_size = normalize_sprite_sheet(
            src, dst, args.frame_width, args.frame_height, args.cols, args.rows,
            target_w, target_h, target_cx, target_cy,
            align_mode=args.align_mode
        )
        print(f'[输出] {os.path.basename(dst)} -> {new_size}')

    # 保存元数据
    meta = {
        'frame_width': args.frame_width,
        'frame_height': args.frame_height,
        'cols': args.cols,
        'rows': args.rows,
        'align_mode': args.align_mode,
        'target_content': {'width': target_w, 'height': target_h, 'center_x': target_cx, 'center_y': target_cy},
        'sprites': [{'file': os.path.basename(a['file']), 'original_size': a['size']} for a in analyses]
    }
    meta_path = os.path.join(args.output, 'sprite-meta.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f'[元数据] 已保存: {meta_path}')


if __name__ == '__main__':
    main()
