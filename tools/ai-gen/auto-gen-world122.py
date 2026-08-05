#!/usr/bin/env python3
"""World-122 fully-automated asset loop.

Pipeline per item (with --auto):
  generate raw on a solid background color the subject does not contain
      (comfyui-gen --transparent, auto-picked via pick_bg_color)
  -> mirror _h covers to the game wall direction (same rule as
     process-world122-assets.py)
  -> cutout to transparent RGBA (transparent_cutout.py + BiRefNet refine)
  -> pixel audit (audit-perspective.py): iso bottom edge, centering,
     h/v pair must be MIRROR (unless --no-pair-check)
  -> optional GLM qualitative gate (--glm-gate): iso/front view, single,
     centered
  -> retry with a new seed until pass or --retries exhausted

Reuses item/prompt definitions from gen-world122-assets.py.

Usage:
  python auto-gen-world122.py --auto --keys cover_B_v cover_D_v \
      --model flux2-dev-fp8 --glm-gate --retries 4
"""

import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time

import numpy as np
from PIL import Image

DIR = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(DIR, "comfyui-gen.py")
AUDIT = os.path.join(DIR, "audit-perspective.py")
CUTOUT = os.path.join(DIR, "transparent_cutout.py")
DESCRIBE = r"C:\Users\allan\.codex\skills\deepseek-vision-skill\scripts\describe-image.js"
ROOT = os.path.dirname(os.path.dirname(DIR))  # game-dev
ASSETS = os.path.join(ROOT, "assets", "terrain")
COMFY_VENV_PY = os.path.join(os.path.dirname(ROOT), "ComfyUI", ".venv", "Scripts", "python.exe")
MANIFEST = os.path.join(ASSETS, "world122-manifest.json")
BAD_LIGHT_TERMS = ["studio lighting", "dramatic lighting", "rim light",
                   "drop shadow", "cast shadow", "directional light"]

GLM_PROMPT = ("这张游戏素材图是否满足：等距斜视或正面平视、单件物体、居中？"
              "直接回答'合格'或'不合格'，不合格请一句话说明原因。")


def load_items_module():
    spec = importlib.util.spec_from_file_location(
        "gen_world122_assets", os.path.join(DIR, "gen-world122-assets.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def item_meta(key):
    if key.startswith("cover_"):
        _, grade, orient = key.split("_")
        return {
            "dst": os.path.join(ASSETS, f"obstacle_cover_{grade}_{orient}.png"),
            "kind": "cover", "orient": orient, "grade": grade,
        }
    suffix = key.replace("defense_tower_", "")
    dst = "obstacle_defense_tower.png" if suffix == "A" else f"obstacle_defense_tower_{suffix}.png"
    return {"dst": os.path.join(ASSETS, dst), "kind": "tower", "orient": "tower"}


def run(cmd, timeout):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None


def gen_raw(it, args):
    cmd = [
        sys.executable, GEN,
        "--host", args.host, "--model", args.model,
        "--prompt-file", it["prompt_file"],
        "--negative", it["negative"],
        "--seed", str(it["seed"]),
        "--out", it["out"],
        "--timeout", str(args.timeout),
    ]
    if args.bg == "solid":
        cmd.append("--transparent")
    t0 = time.time()
    r = run(cmd, args.timeout + 120)
    cost = time.time() - t0
    if r is None:
        print(f"    FAIL gen timeout ({args.timeout + 120}s)", flush=True)
        return False
    if r.returncode == 0 and os.path.exists(it["out"]):
        print(f"    OK {cost:.0f}s -> {it['out']}", flush=True)
        return True
    print(f"    FAIL gen rc={r.returncode} ({cost:.0f}s)", flush=True)
    print((r.stdout or "")[-1200:], flush=True)
    print((r.stderr or "")[-1200:], flush=True)
    return False


def audit_pass(dst, meta, args):
    files = [dst]
    partner = None
    if meta["kind"] == "cover":
        other = "h" if meta["orient"] == "v" else "v"
        partner = os.path.join(ASSETS, f"obstacle_cover_{meta['grade']}_{other}.png")
        if os.path.exists(partner):
            files.append(partner)
    r = run([sys.executable, AUDIT, *files, "--json"], 120)
    if r is None or r.returncode != 0:
        return False, "audit script error"
    data = json.loads(r.stdout)
    img = next((x for x in data.get("images", [])
                if x.get("file") == os.path.basename(dst)), None)
    if not img:
        return False, "audit missing entry"
    if meta["kind"] == "cover":
        single_ok = bool(img.get("isoEdgeOK")) and img.get("centerDX", 1) <= 0.12
        if args.no_pair_check or not os.path.exists(partner):
            return single_ok, (f"single isoEdgeOK={img.get('isoEdgeOK')} "
                               f"centerDX={img.get('centerDX')}")
        pair = data.get("pairs", [None])[0]
        if not pair:
            return False, "pair not detected"
        return pair["verdict"] == "MIRROR" and single_ok, (
            f"pair={pair['verdict']} v_vs_flip={pair['v_vs_flip_h']} "
            f"isoEdgeOK={img.get('isoEdgeOK')} centerDX={img.get('centerDX')}")
    return (img.get("centerDX", 1) <= 0.12
            and img.get("bboxAreaFrac", 0) >= 0.10), (
        f"tower centerDX={img.get('centerDX')} areaFrac={img.get('bboxAreaFrac')}")


def glm_gate(path):
    r = run(["node", DESCRIBE, "--prompt", GLM_PROMPT, path], 300)
    if r is None:
        return True, "glm timeout -> pass"
    if r.returncode != 0:
        return True, "glm error -> pass"
    out = r.stdout or ""
    if "不合格" in out:
        return False, "glm: " + out.strip().replace("\n", " ")[:120]
    return True, "glm ok"


def load_manifest():
    if os.path.exists(MANIFEST):
        try:
            with open(MANIFEST, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            return {}
    return {}


def save_manifest(data):
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


def detect_bg_hex(path, margin=12):
    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    ring = np.concatenate([a[:margin].reshape(-1, 3), a[-margin:].reshape(-1, 3),
                           a[:, :margin].reshape(-1, 3), a[:, -margin:].reshape(-1, 3)])
    bg = np.median(ring, axis=0).astype(int)
    return "#%02X%02X%02X" % (bg[0], bg[1], bg[2])


def verify_assets(items):
    manifest = load_manifest()
    issues = []
    for it in items:
        meta = item_meta(it["key"])
        if not os.path.exists(meta["dst"]):
            issues.append(f"{it['key']}: missing asset {os.path.basename(meta['dst'])}")
        entry = manifest.get(it["key"])
        if not entry:
            issues.append(f"{it['key']}: no manifest entry (pipeline step record missing)")
        elif entry.get("status") != "pass":
            issues.append(f"{it['key']}: manifest status={entry.get('status')}")
        low = it["prompt"].lower()
        for t in BAD_LIGHT_TERMS:
            if re.search(r"(?<!no\s)" + re.escape(t), low):
                issues.append(f"{it['key']}: prompt violates no-shadow rule ('{t}')")
    return issues


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--keys", nargs="*", default=None, help="item keys, e.g. cover_B_v cover_D_v")
    ap.add_argument("--model", default=None, help="models.json model (default: flux2-dev-mesh)")
    ap.add_argument("--host", default=None, help="ComfyUI host (default: 192.168.3.142)")
    ap.add_argument("--timeout", type=int, default=900, help="per-generation timeout")
    ap.add_argument("--bg", choices=["solid", "white"], default="solid",
                    help="background for raw generation")
    ap.add_argument("--retries", type=int, default=4, help="max attempts per item")
    ap.add_argument("--glm-gate", action="store_true",
                    help="add GLM qualitative check to every attempt")
    ap.add_argument("--no-pair-check", action="store_true",
                    help="cover audit does not require h/v pair MIRROR")
    ap.add_argument("--verify", action="store_true",
                    help="check assets vs manifest and no-shadow rule, then exit")
    ap.add_argument("--fallback-model", default="flux2-dev-fp8",
                    help="model to fall back to when the primary mesh model fails")
    ap.add_argument("--fallback-host", default=None,
                    help="host for the fallback model (default: same as --host)")
    args = ap.parse_args()

    gw = load_items_module()
    model = args.model or gw.MODEL
    host = args.host or gw.HOST
    out_dir = gw.OUT_DIR
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)

    items = gw.cover_items() + gw.tower_items()
    if args.keys:
        wanted = set(args.keys)
        items = [it for it in items if it["key"] in wanted]
    if not items:
        print("no items to run", file=sys.stderr)
        sys.exit(1)

    if args.verify:
        issues = verify_assets(items)
        if issues:
            print("\n".join("  - " + i for i in issues), flush=True)
            print(f"\nverify FAIL: {len(issues)} issue(s)", flush=True)
            sys.exit(1)
        print("verify OK: assets present, manifest complete, no shadow/lighting terms",
              flush=True)
        sys.exit(0)

    print(f"[auto-world122] {len(items)} item(s), model {model}@{host}, "
          f"bg={args.bg}, retries={args.retries}, glm_gate={args.glm_gate}",
          flush=True)

    failed = []
    manifest = load_manifest()
    mesh_on = "mesh" in model.lower()
    fallback_model = args.fallback_model
    fallback_host = args.fallback_host or host
    cur_model, cur_host = model, host
    for i, it in enumerate(items, 1):
        meta = item_meta(it["key"])
        dst = meta["dst"]
        print(f"[{i}/{len(items)}] {it['key']} -> {os.path.basename(dst)}", flush=True)
        it["prompt_file"] = os.path.join(out_dir, f"_prompt_{it['key']}.txt")
        with open(it["prompt_file"], "w", encoding="utf-8") as fh:
            fh.write(it["prompt"])
        if args.bg == "white":
            hits = [t for t in BAD_LIGHT_TERMS if t in it["prompt"].lower()]
            if hits:
                print(f"  WARN white-bg prompt contains forbidden terms: {hits}", flush=True)

        backed_up = False
        done = False
        last_attempt = 0
        pnote, gnote = "n/a", "n/a"
        shadow_note = None
        used_model = cur_model
        raw_src = it["out"]
        for attempt in range(1, args.retries + 1):
            last_attempt = attempt
            it["seed"] = it["seed"] + (attempt - 1) * 7777
            print(f"  [attempt {attempt}/{args.retries}] seed={it['seed']}", flush=True)
            used_model = cur_model
            if not gen_raw(it, argparse.Namespace(
                    host=cur_host, model=cur_model, timeout=args.timeout, bg=args.bg)):
                if mesh_on and cur_model == model:
                    print(f"  [fallback] mesh failed, switching to {fallback_model} "
                          f"@{fallback_host}", flush=True)
                    cur_model, cur_host = fallback_model, fallback_host
                continue

            raw_src = it["out"]
            if args.bg == "solid":
                stem, ext = os.path.splitext(it["out"])
                raw_candidate = stem + "_raw" + ext
                if os.path.exists(raw_candidate):
                    raw_src = raw_candidate
                    print(f"    using raw {os.path.basename(raw_src)}", flush=True)

            sh = run([sys.executable, AUDIT, raw_src, "--shadow-check", "--json"], 120)
            if sh is not None and sh.returncode == 0:
                try:
                    shadow_note = json.loads(sh.stdout)["images"][0].get("shadowHint")
                except Exception:
                    shadow_note = None

            src = raw_src
            if meta["orient"] == "h":
                mirrored = os.path.join(out_dir, f"_mir_{it['key']}.png")
                Image.open(raw_src).transpose(Image.FLIP_LEFT_RIGHT).save(mirrored)
                src = mirrored
                print(f"    mirrored -> {os.path.basename(mirrored)}", flush=True)

            if os.path.exists(dst) and not backed_up:
                shutil.copy2(dst, dst + ".bak")
                backed_up = True
                print(f"    backed up old -> {os.path.basename(dst)}.bak", flush=True)

            cut = run([COMFY_VENV_PY, CUTOUT, "--input", src, "--out", dst], 420)
            if cut is None:
                print("    cutout timeout", flush=True)
                continue
            tail = [l for l in (cut.stdout or "").strip().splitlines()[-2:] if l]
            for l in tail:
                print("    " + l, flush=True)
            if cut.returncode != 0:
                print("    cutout FAIL: " + ((cut.stderr or "").strip()[-300:] or ""),
                      flush=True)
                continue

            pixel_ok, pnote = audit_pass(dst, meta, args)
            glm_ok, gnote = True, "skipped"
            if args.glm_gate:
                glm_ok, gnote = glm_gate(dst)
            print(f"    audit: pixel={pixel_ok} ({pnote})  glm={glm_ok} ({gnote})  "
                  f"shadow={shadow_note}" + (" WARN" if shadow_note is not None
                                             and shadow_note > 0.20 else ""),
                  flush=True)
            if pixel_ok and glm_ok:
                print(f"    PASS -> {dst}", flush=True)
                done = True
                break

        manifest[it["key"]] = {
            "key": it["key"], "dst": dst, "status": "pass" if done else "fail",
            "seed": it["seed"],
            "bg_hex": detect_bg_hex(raw_src) if os.path.exists(raw_src) else None,
            "model": used_model,
            "shadow": shadow_note,
            "attempts": last_attempt,
            "pixel": pnote, "glm": gnote,
            "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        save_manifest(manifest)
        if not done:
            failed.append(it["key"])
        for tmp in (it["prompt_file"], os.path.join(out_dir, f"_mir_{it['key']}.png")):
            if os.path.exists(tmp):
                os.remove(tmp)

    print(f"\n[auto-world122] done: ok={len(items) - len(failed)} failed={len(failed)}",
          flush=True)
    if items:
        dsts = [item_meta(it["key"])["dst"] for it in items
                if os.path.exists(item_meta(it["key"])["dst"])]
        if dsts:
            print("\nfinal full audit:", flush=True)
            r = run([sys.executable, AUDIT, *dsts], 180)
            if r is not None:
                print(r.stdout, flush=True)
    if failed:
        print("failed: " + ", ".join(failed), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
