#!/usr/bin/env python3
"""Insert the 12 rare items (流云/蚀月/镇岳 sets + 3 accessories) into both equipment.json copies."""

import json
import os

BASE = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev"
FILES = [
    os.path.join(BASE, "data", "equipment.json"),
    os.path.join(BASE, "public", "data", "equipment.json"),
]

NEW_ITEMS = {
    "flowing_helmet": {
        "name": "流云轻盔", "type": "头盔", "icon": "🪖",
        "category": "armor", "rarity": "rare", "level": 10,
        "equipSlot": "helmet", "armorSet": "flowing", "armorSetSlot": "helmet",
        "defense": {"base": 8, "perEnhance": 2},
        "stats": [{"name": "物理防御", "value": "+8", "pos": True}],
        "desc": "轻甲三件套（头盔/护甲/靴）之一。三件齐穿激活：移动速度+15%、体力恢复+12%。",
        "iconImage": "assets/icons/equipment/流云轻盔.png",
    },
    "flowing_armor": {
        "name": "流云轻甲", "type": "盔甲", "icon": "🥋",
        "category": "armor", "rarity": "rare", "level": 10,
        "equipSlot": "armor", "armorSet": "flowing", "armorSetSlot": "armor",
        "defense": {"base": 13, "perEnhance": 2.5},
        "stats": [{"name": "物理防御", "value": "+13", "pos": True}],
        "desc": "轻甲三件套（头盔/护甲/靴）之一。三件齐穿激活：移动速度+15%、体力恢复+12%。",
        "iconImage": "assets/icons/equipment/流云轻甲.png",
    },
    "flowing_boots": {
        "name": "流云轻靴", "type": "靴子", "icon": "👢",
        "category": "armor", "rarity": "rare", "level": 10,
        "equipSlot": "boots", "armorSet": "flowing", "armorSetSlot": "boots",
        "defense": {"base": 5, "perEnhance": 1.5},
        "stats": [{"name": "物理防御", "value": "+5", "pos": True}],
        "desc": "轻甲三件套（头盔/护甲/靴）之一。三件齐穿激活：移动速度+15%、体力恢复+12%。",
        "iconImage": "assets/icons/equipment/流云轻靴.png",
    },
    "eclipse_helmet": {
        "name": "蚀月法帽", "type": "头盔", "icon": "🧙",
        "category": "armor", "rarity": "rare", "level": 10,
        "equipSlot": "helmet", "armorSet": "eclipse", "armorSetSlot": "helmet",
        "defense": {"base": 7, "perEnhance": 1.5},
        "bonusStats": {"wis": 2},
        "bonusPerEnhance": {"wis": 1.5},
        "stats": [{"name": "物理防御", "value": "+7", "pos": True},
                  {"name": "精神", "value": "+2", "pos": True}],
        "desc": "法袍三件套（帽/袍/靴）之一。三件齐穿激活：技能冷却-18%、魔法伤害+25%。",
        "iconImage": "assets/icons/equipment/蚀月法帽.png",
    },
    "eclipse_armor": {
        "name": "蚀月法袍", "type": "盔甲", "icon": "🧙",
        "category": "armor", "rarity": "rare", "level": 10,
        "equipSlot": "armor", "armorSet": "eclipse", "armorSetSlot": "armor",
        "defense": {"base": 9, "perEnhance": 1.5},
        "bonusStats": {"int": 2},
        "bonusPerEnhance": {"int": 1.5},
        "stats": [{"name": "物理防御", "value": "+9", "pos": True},
                  {"name": "智力", "value": "+2", "pos": True}],
        "desc": "法袍三件套（帽/袍/靴）之一。三件齐穿激活：技能冷却-18%、魔法伤害+25%。",
        "iconImage": "assets/icons/equipment/蚀月法袍.png",
    },
    "eclipse_boots": {
        "name": "蚀月长靴", "type": "靴子", "icon": "👢",
        "category": "armor", "rarity": "rare", "level": 10,
        "equipSlot": "boots", "armorSet": "eclipse", "armorSetSlot": "boots",
        "defense": {"base": 4, "perEnhance": 1.5},
        "stats": [{"name": "物理防御", "value": "+4", "pos": True}],
        "desc": "法袍三件套（帽/袍/靴）之一。三件齐穿激活：技能冷却-18%、魔法伤害+25%。",
        "iconImage": "assets/icons/equipment/蚀月长靴.png",
    },
    "zhenyue_helmet": {
        "name": "镇岳重盔", "type": "头盔", "icon": "⛑",
        "category": "armor", "rarity": "rare", "level": 10,
        "equipSlot": "helmet", "armorSet": "zhenyue", "armorSetSlot": "helmet",
        "defense": {"base": 30, "perEnhance": 2.5},
        "bonusStats": {"maxHp": 19},
        "bonusPerEnhance": {"maxHp": 6.5},
        "stats": [{"name": "物理防御", "value": "+30", "pos": True},
                  {"name": "最大生命值", "value": "+19", "pos": True}],
        "desc": "重甲三件套（盔/甲/靴）之一。三件齐穿激活：40%概率格挡85%伤害、-12%移动速度。",
        "iconImage": "assets/icons/equipment/镇岳重盔.png",
    },
    "zhenyue_armor": {
        "name": "镇岳重甲", "type": "盔甲", "icon": "🛡",
        "category": "armor", "rarity": "rare", "level": 10,
        "equipSlot": "armor", "armorSet": "zhenyue", "armorSetSlot": "armor",
        "defense": {"base": 43, "perEnhance": 4},
        "stats": [{"name": "物理防御", "value": "+43", "pos": True}],
        "desc": "重甲三件套（盔/甲/靴）之一。三件齐穿激活：40%概率格挡85%伤害、-12%移动速度。",
        "iconImage": "assets/icons/equipment/镇岳重甲.png",
    },
    "zhenyue_boots": {
        "name": "镇岳重靴", "type": "靴子", "icon": "🥾",
        "category": "armor", "rarity": "rare", "level": 10,
        "equipSlot": "boots", "armorSet": "zhenyue", "armorSetSlot": "boots",
        "defense": {"base": 15, "perEnhance": 2.5},
        "stats": [{"name": "物理防御", "value": "+15", "pos": True}],
        "desc": "重甲三件套（盔/甲/靴）之一。三件齐穿激活：40%概率格挡85%伤害、-12%移动速度。",
        "iconImage": "assets/icons/equipment/镇岳重靴.png",
    },
    "ring_starfall": {
        "name": "星陨之戒", "type": "戒指", "icon": "💍",
        "category": "accessory", "rarity": "rare", "level": 10,
        "equipSlot": "ring1",
        "bonusStats": {"atk": 4},
        "bonusPerEnhance": {"atk": 2.5},
        "stats": [{"name": "物理攻击", "value": "+4", "pos": True}],
        "desc": "陨星坠落时铸成的戒指，戒身蚀刻着流星轨迹，蓝星宝石蕴含坠落之力。",
        "iconImage": "assets/icons/equipment/星陨之戒.png",
    },
    "belt_endless": {
        "name": "不息腰带", "type": "腰带", "icon": "❤️",
        "category": "accessory", "rarity": "rare", "level": 10,
        "equipSlot": "belt",
        "bonusStats": {"maxHp": 38},
        "bonusPerEnhance": {"maxHp": 19},
        "stats": [{"name": "最大生命值", "value": "+38", "pos": True}],
        "desc": "织入无尽结纹的腰带，生生不息，佩戴者血脉奔涌如长河不竭。",
        "iconImage": "assets/icons/equipment/不息腰带.png",
    },
    "necklace_boulder": {
        "name": "磐心项链", "type": "项链", "icon": "📿",
        "category": "accessory", "rarity": "rare", "level": 10,
        "equipSlot": "necklace",
        "bonusStats": {"str": 3, "con": 3},
        "bonusPerEnhance": {"str": 1.5, "con": 1.5},
        "stats": [{"name": "力量", "value": "+3", "pos": True},
                  {"name": "体质", "value": "+3", "pos": True}],
        "desc": "山岩之心铸成的吊坠，岿然不动，佩戴者如磐石般坚不可摧。",
        "iconImage": "assets/icons/equipment/磐心项链.png",
    },
}


def main():
    for path in FILES:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        equip = data["equipment"]
        added = 0
        for key, item in NEW_ITEMS.items():
            if key not in equip:
                equip[key] = item
                added += 1
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=4)
            fh.write("\n")
        print(f"{path}: added {added} items")


if __name__ == "__main__":
    main()
