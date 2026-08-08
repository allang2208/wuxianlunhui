#!/usr/bin/env python3
"""AI 资产统一入口（2026-08-08）：按大类组织，内部编排现有脚本，不复制逻辑。

结构：
  一个大类 = 一条工作流（当前：monster 四足怪物；未来可加 weapon/terrain/vfx）。
  通用子命令（cutout / bg-color / verify）供所有大类复用。

用法（ComfyUI venv python）：
  # 怪物 idle：5080 生图候选（自动选背景色）→ BiRefNet 抠图 → 512 归一化
  python ai-asset.py monster idle --name bear --ref assets/enemies/bear_idle.png
  # 怪物动画视频：5080 H3 生成（首帧=ref，自动注入主体无色背景）
  python ai-asset.py monster video --name bear --kind run --ref assets/enemies/bear_idle.png
  # 怪物动画 sheet：视频 → 周期/窗口检测 → BiRefNet 重建 → CLEAN 验证
  python ai-asset.py monster rebuild --name bear --video Y:/.../bear_run.mp4 --kind run
  # 查看某怪物的全部产物
  python ai-asset.py monster status --name bear
  # 通用
  python ai-asset.py cutout --src x.png --out x_alpha.png
  python ai-asset.py bg-color --image ref.png
  python ai-asset.py verify --sheet bear_run.png --cell 512

所有子命令支持 --dry-run（只打印将执行的命令不运行）。
"""

import argparse
import os
import subprocess
import sys

import pick_bg_color  # noqa: E402

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
VENV_PY = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\.venv\Scripts\python.exe"
SCRATCH = r"Y:\工作\无尽轮回\scratch"
ASSETS = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\enemies"
HOST = "192.168.3.142"


def run(cmd, dry_run=False):
    cmd = [sys.executable if cmd[0] == "PY" else cmd[0]] + cmd[1:]
    print("$ " + " ".join(str(x) for x in cmd), flush=True)
    if dry_run:
        return 0
    return subprocess.run(cmd, check=True, stderr=subprocess.STDOUT).returncode


def tool(name):
    return os.path.join(TOOLS_DIR, name)


def ensure_dir(p):
    os.makedirs(p, exist_ok=True)


def monster_idle(args):
    out_dir = os.path.join(SCRATCH, f"{args.name}_idle")
    ensure_dir(out_dir)
    # 背景色注入（--bg-color 时对提示词副本做纯色底替换；dry-run 只打印不写文件）
    prompt_file = args.prompt
    if args.bg_color:
        if args.bg_color.lower() == "auto":
            pick = pick_bg_color.pick_bg_color_from_image(args.ref)
            name, hexc = pick["name"], pick["hex"]
        else:
            hexc = args.bg_color.lstrip("#")
            name = pick_bg_color.name_for_hex(hexc)
        print(f"[ai-asset] bg-color: {name} #{hexc}", flush=True)
        if not args.dry_run:
            base = os.path.splitext(os.path.basename(args.prompt))[0]
            prompt_file = os.path.join(out_dir, f"{base}_injected.txt")
            with open(args.prompt, encoding="utf-8") as fh:
                text = fh.read()
            with open(prompt_file, "w", encoding="utf-8") as fh:
                fh.write(pick_bg_color.inject_background(text, name, hexc))
    # 生成候选（默认 5 张，不同 seed）
    for seed in args.seeds.split(","):
        out = os.path.join(out_dir, f"{args.name}-idle_{seed}.png")
        run(["PY", tool("comfyui-gen.py"), "--host", HOST, "--model", args.model,
             "--prompt-file", prompt_file, "--seed", str(seed), "--out", out,
             "--timeout", str(args.timeout)], args.dry_run)
    # 抠图归一化：每张候选出 512 版
    for seed in args.seeds.split(","):
        src = os.path.join(out_dir, f"{args.name}-idle_{seed}.png")
        out = os.path.join(out_dir, f"{args.name}_idle_{seed}_512.png")
        run(["PY", tool("single-idle-prep.py"), "--src", src, "--out", out], args.dry_run)
    print(f"[ai-asset] idle 候选 -> {out_dir}", flush=True)


def monster_video(args):
    out_dir = os.path.join(SCRATCH, f"{args.name}_anim")
    ensure_dir(out_dir)
    prompt = tool(f"prompts/{args.name}-{args.kind}.txt")
    out = os.path.join(out_dir, f"{args.name}_{args.kind}.mp4")
    cmd = ["PY", tool("minimax-h3-gen.py"), "--host", HOST,
           "--first-frame", args.ref, "--last-frame", args.ref,
           "--prompt-file", prompt, "--duration", str(args.duration),
           "--size", args.size, "--steps", str(args.steps),
           "--out", out, "--timeout", str(args.timeout)]
    if args.bg_color:
        cmd += ["--bg-color", args.bg_color]
    run(cmd, args.dry_run)
    print(f"[ai-asset] video -> {out}", flush=True)


def monster_rebuild(args):
    out_dir = os.path.join(SCRATCH, f"{args.name}_anim", "sheets")
    ensure_dir(out_dir)
    out = os.path.join(out_dir, f"{args.name}_{args.kind}.png")
    cmd = ["PY", tool("quadruped-rebuild.py"), "--video", args.video,
           "--kind", args.kind, "--out", out]
    if args.bg_color:
        cmd += ["--bg-color", args.bg_color]
    if args.cell:
        cmd += ["--cell", str(args.cell), "--center-x", str(args.cell // 2),
                "--feet-y", str(round(args.cell * 0.80))]
    run(cmd, args.dry_run)
    print(f"[ai-asset] sheet -> {out}", flush=True)


def monster_status(args):
    import glob
    base = os.path.join(SCRATCH, f"{args.name}_*")
    found = False
    for d in sorted(glob.glob(base)):
        found = True
        print(f"[{d}]")
        for f in sorted(os.listdir(d)):
            full = os.path.join(d, f)
            if os.path.isfile(full):
                print(f"  {f}  ({os.path.getsize(full) // 1024} KB)")
    if not found:
        print(f"no artifacts for '{args.name}' under {SCRATCH}")


def _weapon_spec_default():
    return os.path.join(TOOLS_DIR, "weapon-specs", "m416.json")


def weapon_scaffold(args):
    run(["PY", tool("add-weapon.py"), "--spec", args.spec, "scaffold"], args.dry_run)


def weapon_gen_image(args):
    cmd = ["PY", tool("add-weapon.py"), "--spec", args.spec, "gen-image",
           "--host", args.host, "--model", args.model, "--seeds", args.seeds,
           "--timeout", str(args.timeout)]
    if args.ref_image:
        cmd += ["--ref-image", args.ref_image]
    run(cmd, args.dry_run)


def weapon_process_image(args):
    cmd = ["PY", tool("add-weapon.py"), "--spec", args.spec, "process-image",
           "--raw", args.raw, "--cutout-tool", args.cutout_tool,
           "--rmbg-host", args.rmbg_host, "--rmbg-port", str(args.rmbg_port),
           "--rmbg-model", args.rmbg_model, "--rmbg-timeout", str(args.rmbg_timeout)]
    if args.force:
        cmd += ["--force"]
    if args.no_orient:
        cmd += ["--no-orient"]
    if args.no_auto_level:
        cmd += ["--no-auto-level"]
    run(cmd, args.dry_run)


def weapon_gen_video(args):
    run(["PY", tool("add-weapon.py"), "--spec", args.spec, "gen-video",
         "--host", args.host, "--port", str(args.port),
         "--duration", str(args.duration), "--timeout", str(args.timeout)], args.dry_run)


def weapon_verify(args):
    run(["PY", tool("add-weapon.py"), "--spec", args.spec, "verify"], args.dry_run)


def cutout(args):
    run(["PY", tool("rmbg_cutout.py"), "--src", args.src, "--out", args.out], args.dry_run)


def bg_color(args):
    run(["PY", tool("pick_bg_color.py"), "--image", args.image], args.dry_run)


def verify(args):
    d = os.path.dirname(os.path.abspath(args.sheet))
    f = os.path.basename(args.sheet)
    run(["PY", tool("blackwolf-rebuild-verify.py"), "--dir", d,
         "--file", f] + (["--cell", str(args.cell)] if args.cell else []),
        args.dry_run)


def main():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--dry-run", action="store_true", help="只打印命令不执行")
    ap = argparse.ArgumentParser(description=__doc__, parents=[common],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="category", required=True)

    # ===== monster 大类 =====
    m = sub.add_parser("monster", parents=[common], help="四足怪物动画精灵图工作流")
    msub = m.add_subparsers(dest="action", required=True)

    p = msub.add_parser("idle", parents=[common], help="生成 idle：5080 生图候选 + 抠图归一化")
    p.add_argument("--name", required=True)
    p.add_argument("--ref", required=True, help="参考图（首帧锁体型，也是自动选背景色的依据）")
    p.add_argument("--prompt", required=True, help="提示词文件路径")
    p.add_argument("--model", default="flux2-dev-fp8")
    p.add_argument("--seeds", default="1001,1002,1003,1004,1005",
                   help="逗号分隔 seed 列表")
    p.add_argument("--bg-color", default=None, help="#RRGGBB 或 auto（默认参考图自动选）")
    p.add_argument("--timeout", type=int, default=600)
    p.set_defaults(func=monster_idle)

    p = msub.add_parser("video", parents=[common], help="生成动画视频（H3，5080）")
    p.add_argument("--name", required=True)
    p.add_argument("--kind", choices=["run", "attack", "idle"], required=True)
    p.add_argument("--ref", required=True, help="首帧/尾帧参考图（如 bear_idle.png）")
    p.add_argument("--duration", type=float, default=5.17)
    p.add_argument("--size", default="1024x576")
    p.add_argument("--steps", type=int, default=16)
    p.add_argument("--bg-color", default=None, help="#RRGGBB 或 auto（自动选主体无色）")
    p.add_argument("--timeout", type=int, default=1200)
    p.set_defaults(func=monster_video)

    p = msub.add_parser("rebuild", parents=[common], help="视频 → 动画 sheet（周期/窗口检测 + BiRefNet 重建 + 验证）")
    p.add_argument("--name", required=True)
    p.add_argument("--video", required=True)
    p.add_argument("--kind", choices=["run", "attack"], required=True)
    p.add_argument("--bg-color", default="#FFFFFF", help="视频背景色（生成时用了主体无色底必须传同色）")
    p.add_argument("--cell", type=int, default=None, help="格子尺寸（attack 前扑宽时用 640）")
    p.set_defaults(func=monster_rebuild)

    p = msub.add_parser("status", parents=[common], help="列出该怪物的全部产物")
    p.add_argument("--name", required=True)
    p.set_defaults(func=monster_status)

    # ===== weapon 大类（add-weapon.py 全自动枪械管线）=====
    w = sub.add_parser("weapon", parents=[common], help="枪械武器全自动添加工作流（add-weapon.py）")
    wsub = w.add_subparsers(dest="action", required=True)

    wp = wsub.add_parser("scaffold", parents=[common],
                         help="数据双份写入 + 深度剪影模板 + 提示词 + 三音效 + JS 锚点清单")
    wp.add_argument("--spec", default=_weapon_spec_default())
    wp.set_defaults(func=weapon_scaffold)

    wp = wsub.add_parser("gen-image", parents=[common], help="批量出候选图（comfyui-gen.py）")
    wp.add_argument("--spec", default=_weapon_spec_default())
    wp.add_argument("--host", default="192.168.3.142")
    wp.add_argument("--model", default="flux2-klein-4b")
    wp.add_argument("--seeds", default="1,2,3")
    wp.add_argument("--timeout", type=int, default=900)
    wp.add_argument("--ref-image", default=None, help="真实参考图（白底完整侧视，自动抠剪影锁形）")
    wp.set_defaults(func=weapon_gen_image)

    wp = wsub.add_parser("process-image", parents=[common],
                         help="抠图 + 按 spec.layout 归一化入库 assets/weapons")
    wp.add_argument("--spec", default=_weapon_spec_default())
    wp.add_argument("--raw", required=True)
    wp.add_argument("--force", action="store_true")
    wp.add_argument("--cutout-tool", choices=["auto", "make-transparent-icon", "flood", "none", "rmbg"],
                    default="auto")
    wp.add_argument("--no-orient", action="store_true")
    wp.add_argument("--no-auto-level", action="store_true")
    wp.add_argument("--rmbg-host", default="127.0.0.1")
    wp.add_argument("--rmbg-port", type=int, default=8188)
    wp.add_argument("--rmbg-model", default="BiRefNet-general")
    wp.add_argument("--rmbg-timeout", type=int, default=900)
    wp.set_defaults(func=weapon_process_image)

    wp = wsub.add_parser("gen-video", parents=[common], help="生成武器展示视频（H3，5080）")
    wp.add_argument("--spec", default=_weapon_spec_default())
    wp.add_argument("--host", default="192.168.3.142")
    wp.add_argument("--port", type=int, default=8188)
    wp.add_argument("--duration", type=int, default=2)
    wp.add_argument("--timeout", type=int, default=1800)
    wp.set_defaults(func=weapon_gen_video)

    wp = wsub.add_parser("verify", parents=[common], help="JSON 双份一致 + 资产存在性 + node --check")
    wp.add_argument("--spec", default=_weapon_spec_default())
    wp.set_defaults(func=weapon_verify)

    # ===== 通用子命令 =====
    p = sub.add_parser("cutout", parents=[common], help="通用抠图（ComfyUI-RMBG BiRefNet-general）")
    p.add_argument("--src", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cutout)

    p = sub.add_parser("bg-color", parents=[common], help="基于参考图选主体没有的背景色")
    p.add_argument("--image", required=True)
    p.set_defaults(func=bg_color)

    p = sub.add_parser("verify", parents=[common], help="精灵图 CLEAN 验证")
    p.add_argument("--sheet", required=True)
    p.add_argument("--cell", type=int, default=None)
    p.set_defaults(func=verify)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
