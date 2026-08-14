# -*- coding: utf-8 -*-
"""一次性修复脚本（2026-08-11）：craft-config.json 与 equipment.json 的中文乱码。

背景：2026-08-08 两个提交（e3dd7b6 / fd14fda）经 PowerShell GBK 管道批量写中文，
导致 craft-config.json 62 个改造项的 name/desc 与 equipment.json 神谕三件套的
stats 名称/desc 变成 "????"（SKILL.md #39 同款坑）。

本脚本按 (weapon, slot, id) 逐条重建 name/desc（数字/单位/百分号保留，
中文按提交说明 + 干净同款句式 + effects 语义重建），对两个 JSON 做逐行精准替换，
不改格式、不动其他字段。运行后应验证：两份文件 MD5 一致、全文件无残留 '?'。

用法：python tools/fix-garbled-craft.py
"""

import json
import re
import sys

ROOT = "E:\\无尽轮回\\长期备份\\2026-7-13-1\\game-dev"
CRAFT_FILES = [
    ROOT + "\\data\\craft-config.json",
    ROOT + "\\public\\data\\craft-config.json",
]
EQUIP_FILES = [
    ROOT + "\\data\\equipment.json",
    ROOT + "\\public\\data\\equipment.json",
]

# (weapon, slot, id) -> (name, desc)
FIXES = {
    # ---- weapon6 PKM ----
    ("weapon6", "barrel", "quick_change_barrel"): ("快速换枪管", "换弹时间-1500ms，过热时间-500ms"),
    ("weapon6", "magazine", "light_mag"): ("轻型弹夹", "换弹时间-1.5秒，弹容量-40%，移动速度+10%"),
    ("weapon6", "magazine", "belt_box"): ("弹链供弹箱", "弹夹+50发，移动速度-8%"),
    ("weapon6", "grip", "bipod"): ("两脚架", "静止散布-25%"),
    # ---- weapon7 AKM ----
    ("weapon7", "magazine", "light_mag"): ("轻型弹夹", "换弹时间-1.5秒，弹容量-40%，移动速度+10%"),
    ("weapon7", "bullet", "heavy_762"): ("7.62重弹", "伤害+12%，攻击间隔+20ms，击退+5px"),
    ("weapon7", "stock", "wood_furniture"): ("AKM木托", "后坐力恢复时间-150ms，移动速度-5%"),
    ("weapon7", "stock", "side_folding_stock"): ("侧折叠枪托", "移动速度+8%，散布开始-0.25秒"),
    # ---- weapon21 M416 ----
    ("weapon21", "barrel", "piston_tuning"): ("活塞调校", "攻击间隔-20ms，后坐力恢复时间-100ms"),
    ("weapon21", "magazine", "light_mag"): ("轻型弹夹", "换弹时间-1.5秒，弹容量-40%，移动速度+10%"),
    ("weapon21", "stock", "hk_stock"): ("HK枪托", "移动速度+5%，换弹时间-200ms"),
    ("weapon21", "sight", "picatinny_rail"): ("皮卡汀尼导轨", "散布开始+0.5秒，最大散布角度-5°，高倍镜瞄准模式"),
    # ---- weapon9 G18 ----
    ("weapon9", "muzzle", "integrated_suppressor"): ("一体式消音器", "射程-150px，隐藏枪口火焰，每次射击散布-1°"),
    ("weapon9", "trigger", "burst_conversion"): ("三连发组件", "切换为三连发模式，一次扳机发射三发子弹，每次射击散布+2°"),
    ("weapon9", "trigger", "stabilized_grip"): ("稳定握把", "后坐力恢复时间-150ms，每次射击散布-1°"),
    ("weapon9", "magazine", "drum_mag"): ("33发弹鼓", "弹容量→33，换弹时间+1500ms，移动速度-5%"),
    ("weapon9", "magazine", "quick_mag_holster"): ("快拔弹匣套", "换弹时间-400ms，移动速度+5%"),
    # ---- weapon10 沙鹰 .50 ----
    ("weapon10", "barrel", "match_barrel"): ("比赛级枪管", "射程+100px，每次射击散布-2°，攻击间隔+100ms"),
    ("weapon10", "bullet", "magnum_load"): (".50马格南弹药", "伤害+20%，击退+15px，后坐力恢复时间+150ms"),
    ("weapon10", "trigger", "double_tap_trigger"): ("双发扳机", "切换为二连发模式，一次扳机发射两发子弹，每次射击散布+1°"),
    ("weapon10", "trigger", "light_trigger"): ("轻量化击发组件", "射击间隔-300ms"),
    ("weapon10", "trigger", "curved_trigger"): ("弧形竞技扳机片", "后坐力恢复时间-100ms"),
    ("weapon10", "grip", "heavy_frame"): ("重型握把", "后坐力恢复时间-250ms，移动速度-8%"),
    # ---- weapon22 左轮 .357 ----
    ("weapon22", "muzzle", "heavy_muzzle"): ("重型枪口制退器", "后坐力恢复时间-200ms，每次射击散布-2°"),
    ("weapon22", "muzzle", "compensator"): ("枪口补偿器", "射程+200px，后坐力恢复时间-100ms"),
    ("weapon22", "barrel", "long_barrel"): ("长枪管", "射程+300px，子弹速度+20%"),
    ("weapon22", "barrel", "snub_barrel"): ("短枪管", "射程-150px，移动速度+5%"),
    ("weapon22", "bullet", "magnum_round"): ("马格南重弹", "伤害+10%，击退+15px"),
    ("weapon22", "bullet", "wadcutter_round"): ("平头弹", "穿透+1，伤害+3%"),
    ("weapon22", "bullet", "hollow_point"): ("空尖弹", "击退+30px，伤害+5%"),
    ("weapon22", "trigger", "fanning_hammer"): ("扇击击锤", "攻击间隔-250ms，每次射击散布+2°"),
    ("weapon22", "trigger", "light_trigger"): ("轻量化击发组件", "射击间隔-300ms"),
    ("weapon22", "trigger", "hammer_spring"): ("强化击锤簧", "攻击间隔-150ms，后坐力恢复时间-100ms"),
    ("weapon22", "magazine", "nine_round_cylinder"): ("9发弹巢", "弹容量+3"),
    ("weapon22", "magazine", "speed_loader"): ("快速装弹器", "每次装填2发弹药"),
    ("weapon22", "magazine", "cylinder_lighten"): ("轻量化弹巢", "换弹时间-300ms，移动速度+3%"),
    ("weapon22", "sight", "red_dot"): ("全景红点瞄具", "散布开始 +1秒，单倍瞄准模式"),
    ("weapon22", "sight", "russian_3x_scope"): ("俄制三倍镜", "散布开始 +1秒，高倍镜瞄准模式"),
    ("weapon22", "sight", "scope_mount"): ("瞄准镜座", "射程+150px，高倍镜瞄准模式，攻击间隔+100ms"),
    # ---- weapon19 Beretta ----
    ("weapon19", "muzzle", "compensator"): ("制退器", "后坐力恢复时间-150ms，每次射击散布-1°"),
    ("weapon19", "magazine", "extended_grip"): ("加长弹匣", "备弹+9，换弹时间+300ms"),
    ("weapon19", "trigger", "double_tap"): ("双发点射扳机", "切换为二连发模式，一次扳机发射两发子弹，每次射击散布-1°"),
    # ---- weapon11 QJB ----
    ("weapon11", "barrel", "cooling_barrel"): ("散热枪管", "过热恢复-20%"),
    ("weapon11", "magazine", "light_mag"): ("轻型弹夹", "换弹时间-1.5秒，弹容量-40%，移动速度+10%"),
    ("weapon11", "magazine", "drum_belt"): ("弹鼓", "弹夹+30发，换弹时间+800ms"),
    ("weapon11", "stock", "sustained_fire"): ("持续射击托", "后坐力恢复时间-200ms，最大散布角度-3°"),
    # ---- weapon8 QBZ ----
    ("weapon8", "magazine", "light_mag"): ("轻型弹夹", "换弹时间-1.5秒，弹容量-40%，移动速度+10%"),
    ("weapon8", "grip", "bullpup_balance"): ("无托平衡改造", "移动散布-15%"),
    ("weapon8", "sight", "qbz_scope"): ("无托战术瞄具", "散布开始+0.75秒，单倍瞄准模式，射程+50px"),
    ("weapon8", "trigger", "rapid_trigger"): ("高速扳机", "攻击间隔-15ms，每次射击散布+1°"),
    # ---- weapon12 Super90 ----
    ("weapon12", "bullet", "buckshot_heavy"): ("重鹿弹", "伤害+10%，最大散布角度+3°，击退+8px"),
    ("weapon12", "magazine", "extended_tube"): ("加长弹管", "备弹+2，移动速度-3%"),
    ("weapon12", "magazine", "shell_caddy"): ("快速弹托", "换弹时间-150ms，每次装填2发弹药"),
    # ---- weapon13 SAIGA ----
    ("weapon13", "barrel", "slug_precision"): ("独头弹精调", "独头弹模式下后坐力恢复时间-200ms，射程+100px，每次射击散布-2°"),
    ("weapon13", "grip", "tactical_light"): ("战术灯", "散布开始-0.25秒，单倍瞄准模式"),
    ("weapon13", "trigger", "race_trigger"): ("竞赛扳机", "攻击间隔-40ms，每次射击散布+2°"),
    # ---- weapon15 能量机枪 ----
    ("weapon15", "magazine", "overload_cell"): ("过载能量电池", "伤害+15%，过热时间-1.5秒"),
    ("weapon15", "magazine", "cooling_fin"): ("散热鳍片", "过热恢复-2000ms，移动速度-3%"),
    ("weapon15", "bullet", "focus_lens"): ("聚焦镜片", "最大散布角度-5°，散布开始+0.5秒，伤害+5%"),
    # ---- weapon18 P4040 ----
    ("weapon18", "magazine", "quick_mag"): ("快拔弹匣", "换弹时间-500ms，移动速度+3%"),
    ("weapon18", "bullet", "ap_round"): ("穿甲弹", "防御穿透+30%，目标穿透+1，伤害-3%"),
    ("weapon18", "grip", "tactical_laser"): ("战术激光", "散布开始-0.25秒，每次射击散布-1°"),
}

EQUIP_FIXES = {
    "神谕法帽": {
        "type": "头盔",
        "icon": "🧙",
        "stats": ["物理防御", "精神"],
        "desc": "神谕三件套（法帽/法袍/长靴）之一。三件齐穿激活：技能冷却-28%、魔法伤害+35%。",
    },
    "神谕法袍": {
        "type": "盔甲",
        "icon": "🧙",
        "stats": ["物理防御", "智力"],
        "desc": "神谕三件套（法帽/法袍/长靴）之一。三件齐穿激活：技能冷却-28%、魔法伤害+35%。",
    },
    "神谕长靴": {
        "type": "靴子",
        "icon": "👢",
        "stats": ["物理防御"],
        "desc": "神谕三件套（法帽/法袍/长靴）之一。三件齐穿激活：技能冷却-28%、魔法伤害+35%。",
    },
}


def apply_craft_fixes(text):
    """逐行精准替换 craft-config：按 weapon -> options -> slot -> id 定位 name/desc。"""
    lines = text.split("\n")
    cur_w = None
    in_opts = False
    cur_slot = None
    cur_id = None
    changed = 0
    for i, ln in enumerate(lines):
        m = re.match(r'^\s*"(weapon\d+)": \{', ln)
        if m:
            cur_w = m.group(1)
            in_opts = False
            cur_slot = None
            cur_id = None
            continue
        if cur_w is None:
            continue
        if re.match(r'^\s*"options": \{', ln):
            in_opts = True
            continue
        if not in_opts:
            continue
        m = re.match(r'^\s*"([A-Za-z0-9_]+)": \[', ln)
        if m:
            cur_slot = m.group(1)
            cur_id = None
            continue
        m = re.match(r'^\s*"id": "([A-Za-z0-9_]+)"', ln)
        if m:
            cur_id = m.group(1)
            continue
        m = re.match(r'^(\s*)"(name|desc)": "(.*)"(,?)(\s*)$', ln)
        if m and cur_id:
            key = (cur_w, cur_slot, cur_id)
            if key in FIXES:
                newval = FIXES[key][0] if m.group(2) == "name" else FIXES[key][1]
                old = m.group(3)
                if "?" in old:
                    lines[i] = m.group(1) + '"' + m.group(2) + '": "' + newval + '"' + m.group(4) + m.group(5)
                    changed += 1
        if re.match(r'^ {16}\}', ln) or re.match(r'^\t{4}\}', ln):
            cur_id = None
    return "\n".join(lines), changed


def apply_equip_fixes(text):
    """逐行精准替换 equipment：按条目 name 定位，修 stats 的 name 与 desc。"""
    lines = text.split("\n")
    cur_item = None
    stat_idx = 0
    changed = 0
    for i, ln in enumerate(lines):
        m = re.match(r'^\s*"name": "神谕(法帽|法袍|长靴)"', ln)
        if m:
            cur_item = "神谕" + m.group(1)
            stat_idx = 0
            continue
        if cur_item and cur_item in EQUIP_FIXES:
            fix = EQUIP_FIXES[cur_item]
            m = re.match(r'^(\s*)"(type|icon)": "(\?\?+)"(,?)(\s*)$', ln)
            if m:
                lines[i] = m.group(1) + '"' + m.group(2) + '": "' + fix[m.group(2)] + '"' + m.group(4) + m.group(5)
                changed += 1
                continue
            m = re.match(r'^(\s*)"name": "(\?\?+)"(,?)(\s*)$', ln)
            if m and stat_idx < len(fix["stats"]):
                lines[i] = m.group(1) + '"name": "' + fix["stats"][stat_idx] + '"' + m.group(3) + m.group(4)
                changed += 1
                stat_idx += 1
                continue
            m = re.match(r'^(\s*)"desc": "(.*)"(,?)(\s*)$', ln)
            if m and "?" in m.group(2):
                lines[i] = m.group(1) + '"desc": "' + fix["desc"] + '"' + m.group(3) + m.group(4)
                changed += 1
        if re.match(r'^ {8}\}', ln):
            cur_item = None
    return "\n".join(lines), changed


def count_qmarks(text):
    return text.count("?")


def main():
    ok = True
    for path in CRAFT_FILES:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        before = count_qmarks(text)
        new_text, changed = apply_craft_fixes(text)
        # 校验 JSON 仍可解析
        try:
            json.loads(new_text)
        except Exception as e:
            print("[FAIL] %s JSON 解析失败: %s" % (path, e))
            ok = False
            continue
        after = count_qmarks(new_text)
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(new_text)
        print("[OK] %s: 替换 %d 行, ? 数量 %d -> %d" % (path, changed, before, after))
        if after != 0:
            ok = False

    for path in EQUIP_FILES:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        before = count_qmarks(text)
        new_text, changed = apply_equip_fixes(text)
        try:
            json.loads(new_text)
        except Exception as e:
            print("[FAIL] %s JSON 解析失败: %s" % (path, e))
            ok = False
            continue
        after = count_qmarks(new_text)
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(new_text)
        print("[OK] %s: 替换 %d 行, ? 数量 %d -> %d" % (path, changed, before, after))
        if after != 0:
            ok = False

    print("ALL_OK" if ok else "HAS_REMAINING")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
