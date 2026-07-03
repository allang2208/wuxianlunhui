# 关键工作信息

**最后更新**: 2026-07-03
**项目目录**: `C:\Users\allan\Documents\kimi\workspace\game-dev`
**技术栈**: Phaser v4.0.0 + 自定义 Canvas 2D Hybrid 渲染, Vite + Electron

---

## 核心配置

### 怪物数值（已调整）
- **所有怪物 HP 减半**（data/enemies.json）
- **普通/次级类型怪物攻击力统一为 25**
  - 普通类型: zombie, runnerZombie, spider, blackWolf, skeletonArcher, skeletonDog
  - 次级类型: babySpider, skeletonWarrior
- **精英/首领攻击力保持不变**

### 技能配置
- **冰锥 (iceSpike)**: flySpeed=1600, maxRange=800, 左右交替生成, 飞行中禁止重新生成
- **火球 (fireball)**: 73 帧 Sprite Sheet (9×9), flySpeed=1600, 范围爆炸+火焰特效
- **持盾防御 (shieldBlock)**: 被动技能, 增强盾牌防御/弹反效果

### 武器配置
- **P4040**: 独立 `canvasImageProp='p4040Image'`, 预加载 key `weapon_p4040`
- **沙漠之鹰 (Deagle)**: 预加载 key `weapon_deagle`, 文件 `Desert eagle-eqiup.png`（注意空格）
- **G18**: 补齐 `fireSound`/`reloadSound`/`equipSound` 字段（`shop-system.js`）
- **骑士长剑 (weapon3)**: 使用 `GoldenConvergeEffect`, 汇聚点改为动态剑尖位置

---

## 关键代码模式

### 双持散布计时器修复（player.js）
```javascript
const _offSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
const _offItem = this.equipments[_offSlot];
const _isDual = _offItem && _offItem.name && !_offItem.isTwoHanded;
const _shouldTrackSpread = _isGun && (Input.mouse.leftDown || (_isDual && Input.mouse.rightDown));
```

### 瞄准模式（双持除外）
```javascript
const isDualWield = offhandItem && offhandItem.name && !offhandItem.isTwoHanded;
if (isGun && Input.mouse.rightDown && !(isPistol && isDualWield)) {
    this._aimModeActive = true;
}
```

### 特殊攻击 CD 独立计算
```javascript
// player._specialAttackCooldowns 对象按 specialAttackType 存储
this._specialAttackCooldowns[config.specialAttackType] = now;
```

### Map 遍历（entities 参数）
```javascript
// entities 是 Map 对象，不是数组
const entityList = Array.from(entities.values ? entities.values() : entities);
for (const entity of entityList) { ... }
```

### Phaser 纹理映射一致性
- `getWeaponTextureKey()` 和 `getWeaponTextureLoadList()` 必须保持同步
- 所有 Phaser Sprite 使用的纹理必须在 `BootScene.preload` 中预加载

---

## 已知陷阱

1. **Phaser 不支持 GIF**: 必须用 GIF→Sprite Sheet 转换
2. **文件名空格**: Vite 中可正常加载（URL 编码为 `%20`）
3. **P4040 除以零**: `spreadParams.maxTime=0` 导致 `0/0=NaN`，需加防护
4. **混合渲染**: `_usePhaserWeapon` 开关决定由 Phaser 还是 Canvas 2D 渲染武器
5. **技能经验**: `SkillLevelSystem.addExp(skill, amount, player)` + `refreshUI(skillId)`
6. **伤害公式**: `base + matk * magicMul + int * intMul`

---

## 活跃问题

- **无活跃问题**：所有报告 bug 已修复

## 工作规则

**未获用户明确指示的情况下，不得修改现有的公式、数值和常量定义。** 涉及攻击力、防御力、速度、概率、成本等数值改动时，必须先输出拟改方案，经用户确认后方可执行。
