// ============================================================
// HamsterLightCavalryAI — 仓鼠轻骑（世界-122）
//
// 轻骑与盾卫/民兵共享“最近敌人 → 追击 → 指定帧近战判定 → 无敌跟随玩家”
// 的配置驱动状态机。伤害、速度、判定帧与攻击周期全部读取
// data/hamster-light-cavalry-config.json；能源矿点由共享 AI 明确排除。
// ============================================================
import { HamsterGuardAI } from './hamster-guard-ai.js';

export class HamsterLightCavalryAI extends HamsterGuardAI {}
