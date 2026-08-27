#!/usr/bin/env python3
"""AI 资产统一入口（2026-08-08）：按大类组织，内部编排现有脚本，不复制逻辑。

结构：
  一个大类 = 一条工作流（当前：monster 四足怪物；未来可加 weapon/terrain/vfx）。
  通用子命令（cutout / bg-color / verify）供所有大类复用。

用法（ComfyUI venv python）：
  # 怪物 idle：5080 生图候选（自动选背景色）→ BiRefNet 抠图 → 512 归一化
  python ai-asset.py monster idle --name bear --ref assets/enemies/bear_idle.png
  # 怪物动画视频：默认先用本地豆包免费额度；额度耗尽或明确指定时切 5080 H3
  python ai-asset.py monster video --name bear --kind run --ref assets/enemies/bear_idle.png
  python ai-asset.py monster video --provider doubao --candidates 3 --name bear --kind run --ref assets/enemies/bear_idle.png
  # 怪物动画 sheet：视频 → 周期/窗口检测 → BiRefNet 重建 → CLEAN 验证
  python ai-asset.py monster rebuild --name bear --video Y:/.../bear_run.mp4 --kind run
  # 查看某怪物的全部产物
  python ai-asset.py monster status --name bear
  # 通用
  python ai-asset.py video generate --provider doubao --ref first.png --prompt prompt.txt --out candidate.mp4
  python ai-asset.py cutout --src x.png --out x_alpha.png
  python ai-asset.py bg-color --image ref.png
  python ai-asset.py verify --sheet bear_run.png --cell 512

所有子命令支持 --dry-run（只打印将执行的命令不运行）。
"""

import argparse
import base64
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


def add_video_provider_args(parser):
    parser.add_argument("--provider", choices=["h3", "doubao"], default="doubao",
                        help="视频后端：doubao=本地豆包免费额度优先（默认）；h3=额度耗尽、特殊需求或明确指定时使用远程 5080 MiniMax H3")
    parser.add_argument("--candidates", type=int, default=1,
                        help="豆包连续抽取候选数；默认 1（每个候选都会消耗额度）")
    parser.add_argument("--doubao-model", default="Seedance 2.0 Mini",
                        help="豆包视频模型；默认 Seedance 2.0 Mini")
    parser.add_argument("--doubao-cdp-port", type=int, default=9333,
                        help="豆包客户端本地自动化端口")
    parser.add_argument("--doubao-attach-only", action="store_true",
                        help="只连接已用自动化端口启动的豆包，不自动启动客户端")
    parser.add_argument("--doubao-new-chat", action="store_true",
                        help="每次生成前新建豆包对话，隔离旧视频与本次结果")
    parser.add_argument("--doubao-confirm-paid", action="store_true",
                        help="仅在用户已明确授权时，确认豆包页面的付费额度提示")


def video_command(args, prompt, out, loop=False):
    """Build one provider command while keeping downstream MP4 contracts identical."""
    if args.provider == "doubao":
        cmd = ["node", tool("doubao-seedance-gen.mjs"),
               "--ref", args.ref, "--prompt-file", prompt,
               "--duration", str(args.duration), "--size", args.size,
               "--model", args.doubao_model,
               "--candidates", str(args.candidates),
               "--out", out, "--timeout", str(args.timeout),
               "--cdp-port", str(args.doubao_cdp_port)]
        if loop:
            cmd += ["--loop"]
        if args.doubao_attach_only:
            cmd += ["--attach-only"]
        if args.doubao_new_chat:
            cmd += ["--new-chat"]
        if args.doubao_confirm_paid:
            cmd += ["--confirm-paid"]
        return cmd

    if args.candidates != 1:
        raise ValueError("--candidates is currently supported only by --provider doubao")
    cmd = ["PY", tool("minimax-h3-gen.py"), "--host", HOST,
           "--first-frame", args.ref, "--prompt-file", prompt,
           "--duration", str(args.duration), "--size", args.size,
           "--steps", str(args.steps), "--out", out,
           "--timeout", str(args.timeout)]
    last_frame = getattr(args, "last_frame", None)
    if last_frame:
        cmd += ["--last-frame", last_frame]
    elif loop:
        cmd += ["--last-frame", args.ref]
    if getattr(args, "seed", None) is not None:
        cmd += ["--seed", str(args.seed)]
    if getattr(args, "bg_color", None):
        cmd += ["--bg-color", args.bg_color]
    return cmd


def prepare_doubao_background_prompt(args, prompt, out_dir):
    """Mirror H3's solid-background injection before handing a prompt to Doubao."""
    bg_color = getattr(args, "bg_color", None)
    if args.provider != "doubao" or not bg_color:
        return prompt
    if bg_color.lower() == "auto":
        pick = pick_bg_color.pick_bg_color_from_image(args.ref)
        name, hexc = pick["name"], pick["hex"]
    else:
        hexc = bg_color.lstrip("#")
        name = pick_bg_color.name_for_hex(hexc)
    injected = os.path.join(out_dir, f"{os.path.splitext(os.path.basename(prompt))[0]}_doubao_bg.txt")
    print(f"[ai-asset] doubao bg-color: {name} #{hexc}", flush=True)
    if not args.dry_run:
        with open(prompt, encoding="utf-8") as fh:
            text = fh.read()
        with open(injected, "w", encoding="utf-8") as fh:
            fh.write(pick_bg_color.inject_background(text, name, hexc))
    return injected


def monster_idle(args):
    out_dir = os.path.abspath(args.out_dir) if args.out_dir else os.path.join(SCRATCH, f"{args.name}_idle")
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


def generic_video_generate(args):
    out = os.path.abspath(args.out)
    ensure_dir(os.path.dirname(out))
    prompt = prepare_doubao_background_prompt(args, args.prompt, os.path.dirname(out))
    cmd = video_command(args, prompt, out, loop=args.loop)
    run(cmd, args.dry_run)
    if args.provider == "doubao" and args.candidates > 1:
        stem, ext = os.path.splitext(out)
        print(f"[ai-asset] video candidates -> {stem}_c01..c{args.candidates:02d}{ext}", flush=True)
    else:
        print(f"[ai-asset] video -> {out}", flush=True)


def monster_video(args):
    out_dir = os.path.join(SCRATCH, f"{args.name}_anim")
    ensure_dir(out_dir)
    prompt = tool(f"prompts/{args.name}-{args.kind}.txt")
    out = os.path.join(out_dir, f"{args.name}_{args.kind}.mp4")
    prompt = prepare_doubao_background_prompt(args, prompt, out_dir)
    cmd = video_command(args, prompt, out, loop=True)
    if args.provider == "doubao":
        print("[ai-asset] 注意：豆包 Mini 仅用提示词要求回到首姿；不提供 H3 的像素级 last-frame 锁定，"
              "循环候选仍须在 rebuild 后验缝。", flush=True)
    run(cmd, args.dry_run)
    if args.provider == "doubao" and args.candidates > 1:
        stem, ext = os.path.splitext(out)
        print(f"[ai-asset] video candidates -> {stem}_c01..c{args.candidates:02d}{ext}", flush=True)
    else:
        print(f"[ai-asset] video -> {out}", flush=True)


def monster_rebuild(args):
    out_dir = os.path.join(SCRATCH, f"{args.name}_anim", "sheets")
    out = args.out or os.path.join(out_dir, f"{args.name}_{args.kind}.png")
    ensure_dir(os.path.dirname(os.path.abspath(out)))
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


def _ssh(cmd, dry_run=False):
    full = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "r5080", cmd]
    print("$ " + " ".join(full), flush=True)
    if dry_run:
        return
    subprocess.run(full, check=True)


def _ps_b64(script):
    return base64.b64encode(script.encode("utf-16-le")).decode()


def icon_transparent(args):
    run(["PY", tool("make-transparent-icon.py"), args.src, args.dst], args.dry_run)


def icon_normalize(args):
    run(["PY", tool("normalize-skill-icon.py"), args.src, args.dst], args.dry_run)


def icon_check(args):
    run(["PY", tool("check-icon-sizes.py")], args.dry_run)


def icon_pipeline(args):
    cmd = ["PY", tool("birefnet-icon-pipeline.py")]
    if args.keys:
        cmd += ["--keys", args.keys]
    run(cmd, args.dry_run)


def humanoid_loop(args):
    cmd = ["PY", tool("h3-loop-spritesheet.py"), "--video", args.video, "--out", args.out,
           "--cols", str(args.cols), "--step", str(args.step),
           "--target-h", str(args.target_h), "--feet-y", str(args.feet_y),
           "--center-x", str(args.center_x), "--cell", str(args.cell),
           "--steady", args.steady, "--period", args.period,
           "--min-iou", str(args.min_iou)]
    if args.out_gif:
        cmd += ["--out-gif", args.out_gif]
    run(cmd, args.dry_run)


def humanoid_attack(args):
    cmd = ["PY", tool("h3-attack-spritesheet.py"), "--video", args.video, "--out", args.out,
           "--cols", str(args.cols), "--min-diff", str(args.min_diff),
           "--target-h", str(args.target_h), "--feet-y", str(args.feet_y),
           "--center-x", str(args.center_x), "--cell", str(args.cell),
           "--threshold", str(args.threshold), "--feather", str(args.feather)]
    if args.frames:
        cmd += ["--frames", args.frames]
    if args.out_gif:
        cmd += ["--out-gif", args.out_gif]
    run(cmd, args.dry_run)


def humanoid_video(args):
    """Generate a humanoid H3 action clip through the shared asset entrypoint."""
    out_dir = os.path.join(SCRATCH, f"{args.name}_anim")
    prompt = args.prompt or tool(f"prompts/{args.name}-{args.kind}.txt")
    out = args.out or os.path.join(out_dir, f"{args.name}_{args.kind}.mp4")
    # Explicit project-local outputs must not depend on the optional Y: scratch drive.
    ensure_dir(os.path.dirname(os.path.abspath(out)))
    if args.provider == "doubao" and args.seed is not None:
        print("[ai-asset] 豆包客户端不暴露 seed；已忽略 --seed。", flush=True)
    cmd = video_command(args, prompt, out, loop=not args.one_way)
    run(cmd, args.dry_run)
    if args.provider == "doubao" and args.candidates > 1:
        stem, ext = os.path.splitext(out)
        print(f"[ai-asset] humanoid video candidates -> {stem}_c01..c{args.candidates:02d}{ext}", flush=True)
    else:
        print(f"[ai-asset] humanoid video -> {out}", flush=True)


def lora_prep(args):
    run(["PY", tool("prep-lora-dataset.py")], args.dry_run)


def lora_train(args):
    yaml = args.yaml
    if not yaml.startswith("D:"):
        local = os.path.abspath(yaml)
        fname = os.path.basename(local)
        cmd = ["scp", "-o", "BatchMode=yes", local, f"r5080:D:/lora-train-src/{fname}"]
        print("$ " + " ".join(cmd), flush=True)
        if not args.dry_run:
            subprocess.run(cmd, check=True)
        yaml = f"D:/lora-train-src/{fname}"
    script = (f"cd /d D:\\开发文件\\lora-train && "
              f".venv\\Scripts\\python.exe -u run.py {yaml} *> train.log 2>&1")
    b64 = _ps_b64(script)
    remote = (f"schtasks /create /tn LoraTrain "
              f"/tr \"powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand {b64}\" "
              f"/sc once /st 00:00 /ru SYSTEM /f && schtasks /run /tn LoraTrain")
    _ssh(remote, args.dry_run)


def lora_status(args):
    remote = ("tasklist | findstr /i python & "
              "nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader & "
              "dir D:\\开发文件\\lora-train\\output /o-d /b 2>nul")
    _ssh(remote, args.dry_run)


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

    # ===== provider-neutral reference image + prompt -> MP4 =====
    vg = sub.add_parser("video", parents=[common], help="参考图 + 提示词 → MP4（H3 或本地豆包）")
    vgsub = vg.add_subparsers(dest="action", required=True)
    vp = vgsub.add_parser("generate", parents=[common], help="生成一个或多个视频候选")
    vp.add_argument("--ref", required=True, help="参考图/首帧")
    vp.add_argument("--last-frame", help="H3 独立尾帧；用于变身等首尾身份双锁动作")
    vp.add_argument("--prompt", required=True, help="提示词文件路径")
    vp.add_argument("--out", required=True, help="MP4 输出路径；多个豆包候选自动加 _c01 后缀")
    vp.add_argument("--duration", type=float, default=5.17)
    vp.add_argument("--size", default="1024x576")
    vp.add_argument("--steps", type=int, default=16, help="仅 H3 使用")
    vp.add_argument("--seed", type=int, default=None, help="仅 H3 使用")
    vp.add_argument("--bg-color", default=None, help="#RRGGBB 或 auto；两种后端均注入同色纯色底提示")
    vp.add_argument("--timeout", type=int, default=1800)
    vp.add_argument("--loop", action="store_true",
                    help="要求回到首姿；H3 锁 last-frame，豆包仅追加循环提示词")
    add_video_provider_args(vp)
    vp.set_defaults(func=generic_video_generate)

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
    p.add_argument("--out-dir", default=None,
                   help="显式候选输出目录；缺省仍写入统一 scratch")
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
    add_video_provider_args(p)
    p.set_defaults(func=monster_video)

    p = msub.add_parser("rebuild", parents=[common], help="视频 → 动画 sheet（周期/窗口检测 + BiRefNet 重建 + 验证）")
    p.add_argument("--name", required=True)
    p.add_argument("--video", required=True)
    p.add_argument("--kind", choices=["run", "attack"], required=True)
    p.add_argument("--bg-color", default="#FFFFFF", help="视频背景色（生成时用了主体无色底必须传同色）")
    p.add_argument("--cell", type=int, default=None, help="格子尺寸（attack 前扑宽时用 640）")
    p.add_argument("--out", default=None, help="显式输出路径；缺省仍写入统一 Y: scratch")
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
    wp.add_argument("--model", default="flux2-dev-fp8")
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

    # ===== icon 大类（装备/道具/技能图标）=====
    ic = sub.add_parser("icon", parents=[common], help="装备/道具/技能图标统一处理")
    icsub = ic.add_subparsers(dest="action", required=True)

    ip = icsub.add_parser("transparent", parents=[common], help="白底图抠成透明 RGBA")
    ip.add_argument("--src", required=True)
    ip.add_argument("--dst", required=True)
    ip.set_defaults(func=icon_transparent)

    ip = icsub.add_parser("normalize", parents=[common], help="技能图标归一化到系列基线")
    ip.add_argument("--src", required=True)
    ip.add_argument("--dst", required=True)
    ip.set_defaults(func=icon_normalize)

    ip = icsub.add_parser("check", parents=[common], help="扫描 skills.json 全部图标内容尺寸")
    ip.set_defaults(func=icon_check)

    ip = icsub.add_parser("pipeline", parents=[common], help="图标全管线：BiRefNet 抠图 → 1536² 归一化")
    ip.add_argument("--keys", default=None, help="逗号分隔 key 列表（缺省全部）")
    ip.set_defaults(func=icon_pipeline)

    # ===== humanoid 大类（人形怪/工头动画：h3-loop / h3-attack）=====
    hm = sub.add_parser("humanoid", parents=[common], help="人形怪动画精灵图（h3-loop/h3-attack 抽帧）")
    hmsub = hm.add_subparsers(dest="action", required=True)

    hp = hmsub.add_parser("video", parents=[common], help="生成双足角色 H3 动作视频")
    hp.add_argument("--name", required=True)
    hp.add_argument("--kind", choices=["idle", "run", "attack", "howl", "die"], required=True)
    hp.add_argument("--ref", required=True, help="纯色背景首帧；循环/回位动作也作为尾帧")
    hp.add_argument("--prompt", default=None, help="提示词文件；缺省 prompts/<name>-<kind>.txt")
    hp.add_argument("--out", default=None)
    hp.add_argument("--duration", type=float, default=5.17)
    hp.add_argument("--size", default="1024x576")
    hp.add_argument("--steps", type=int, default=16)
    hp.add_argument("--seed", type=int, default=None)
    hp.add_argument("--timeout", type=int, default=1800)
    hp.add_argument("--one-way", action="store_true",
                    help="仅锁首帧，不回到参考站姿（死亡等不可逆动作）")
    add_video_provider_args(hp)
    hp.set_defaults(func=humanoid_video)

    hp = hmsub.add_parser("loop", parents=[common], help="循环动画抽帧（无缝循环 sheet）")
    hp.add_argument("--video", required=True)
    hp.add_argument("--out", required=True)
    hp.add_argument("--cols", type=int, default=5)
    hp.add_argument("--step", type=int, default=4)
    hp.add_argument("--target-h", type=int, default=262)
    hp.add_argument("--feet-y", type=int, default=410)
    hp.add_argument("--center-x", type=int, default=256)
    hp.add_argument("--cell", type=int, default=512)
    hp.add_argument("--steady", default="12,105")
    hp.add_argument("--period", default="70,120")
    hp.add_argument("--min-iou", type=float, default=0.80)
    hp.add_argument("--out-gif", default=None)
    hp.set_defaults(func=humanoid_loop)

    hp = hmsub.add_parser("attack", parents=[common], help="攻击动画抽帧（一次性弧线）")
    hp.add_argument("--video", required=True)
    hp.add_argument("--out", required=True)
    hp.add_argument("--cols", type=int, default=4)
    hp.add_argument("--frames", default=None, help="显式帧列表（逗号分隔）")
    hp.add_argument("--min-diff", type=float, default=0.10)
    hp.add_argument("--target-h", type=int, default=262)
    hp.add_argument("--feet-y", type=int, default=410)
    hp.add_argument("--center-x", type=int, default=256)
    hp.add_argument("--cell", type=int, default=512)
    hp.add_argument("--threshold", type=int, default=248)
    hp.add_argument("--feather", type=float, default=0.3)
    hp.add_argument("--out-gif", default=None)
    hp.set_defaults(func=humanoid_attack)

    # ===== lora 大类（5080 LoRA 训练）=====
    lr = sub.add_parser("lora", parents=[common], help="LoRA 训练（数据集准备 / 5080 训练 / 状态）")
    lrsub = lr.add_subparsers(dest="action", required=True)

    lp = lrsub.add_parser("prep", parents=[common], help="从技能图标生成训练集（dataset + 提示词）")
    lp.set_defaults(func=lora_prep)

    lp = lrsub.add_parser("train", parents=[common], help="启动 5080 训练（schtasks 防断连杀进程）")
    lp.add_argument("--yaml", required=True, help="训练配置（远程 D:/... 路径或本地文件自动 scp 到 D:/lora-train-src/）")
    lp.set_defaults(func=lora_train)

    lp = lrsub.add_parser("status", parents=[common], help="查询 5080 训练状态（进程/GPU/checkpoint）")
    lp.set_defaults(func=lora_status)

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
