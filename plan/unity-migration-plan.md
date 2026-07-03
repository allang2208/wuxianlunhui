# Unity 3D 迁移方案 — 无限轮回 (JS → Unity 2022.3 LTS)

> **版本**: 3D 2.5D 方案（正交相机 + 3D模型）
> **Unity**: 2022.3.62f3c1 LTS
> **渲染管线**: Built-in 3D (正交投影)
> **输入**: New Input System
> **动画**: Mecanim (Humanoid/Generic)

---

## 一、核心架构决策

### 1.1 为什么选 3D 模型而不是 2D Sprite？

| 维度 | 2D Sprite | 3D 模型 (Meshy) |
|------|----------|----------------|
| 美术资产 | 需要手绘多方向帧动画 | Meshy AI 一键生成，自动带骨骼 |
| 动画 | 手动切帧 + 代码控制 | 骨骼动画自动播放，物理自然 |
| 方向 | 需要 4/8 套方向图 | 1 套动画 + 旋转模型 = 任意方向 |
| 武器挂载 | 代码计算偏移位置 | 骨骼挂载点，自然跟随手部 |
| 特效 | 2D 粒子系统 | 3D 粒子 + 灯光效果更丰富 |
| 未来扩展 | 换方向需重画 | 可换装、换色、加动作 |

### 1.2 相机设置

- **Projection**: Orthographic（正交）
- **Rotation**: `(60, 45, 0)` — 60°俯视 + 45°侧偏，兼顾角色正面展示和操作清晰度
- **Size**: 根据角色大小调整，建议 5~8
- **Clear Flags**: Solid Color（背景色根据场景：雪地用浅蓝/白，草地用深绿）

### 1.3 方向处理方案

**方案：角色整体旋转 + 1 套动画**

```
移动输入 → 计算方向向量 → 旋转角色 GameObject → 播放 Walk 动画
```

- 不制作 8 方向动画
- Meshy 导出 1 套通用动画（Idle, Walk, Attack）
- 角色通过 `transform.rotation` 或 `transform.right` 面朝移动方向
- 攻击时角色面向鼠标方向

### 1.4 武器挂载方案

```
Player (Root)
├── Model (FBX SkinnedMeshRenderer)
│   └── Armature (骨骼层级)
│       └── ...
│       └── RightHand (手掌骨骼)
│           └── WeaponSocket (空物体，本地位置调整)
│               └── WeaponPrefab (武器模型)
├── Animator
└── PlayerController.cs
```

---

## 二、Unity 项目目录结构（3D 版）

```
Assets/
├── _Project/
│   ├── Scripts/
│   │   ├── Core/
│   │   │   ├── GameManager.cs
│   │   │   ├── ObjectPool.cs
│   │   │   ├── EventBus.cs
│   │   │   └── Constants.cs
│   │   ├── Entities/
│   │   │   ├── PlayerController.cs
│   │   │   ├── EnemyController.cs
│   │   │   └── NPCController.cs
│   │   ├── Combat/
│   │   │   ├── IDamageable.cs
│   │   │   ├── Damageable.cs
│   │   │   ├── HitboxTrigger.cs
│   │   │   └── Projectile.cs
│   │   ├── Weapons/
│   │   │   ├── WeaponBase.cs
│   │   │   ├── MeleeWeapon.cs
│   │   │   ├── RangedWeapon.cs
│   │   │   └── WeaponHolder.cs
│   │   ├── Skills/
│   │   │   ├── SkillBase.cs
│   │   │   ├── SkillManager.cs
│   │   │   └── ...（各技能实现）
│   │   ├── Items/
│   │   │   ├── ItemData.cs
│   │   │   ├── EquipmentManager.cs
│   │   │   └── InventoryManager.cs
│   │   ├── UI/
│   │   │   ├── UIManager.cs
│   │   │   ├── HUDController.cs
│   │   │   ├── DamageText.cs
│   │   │   └── ...
│   │   ├── World/
│   │   │   ├── CameraController.cs
│   │   │   ├── WorldGenerator.cs
│   │   │   └── GroundTile.cs
│   │   ├── Effects/
│   │   │   ├── EffectManager.cs
│   │   │   └── ...
│   │   ├── Audio/
│   │   │   └── AudioManager.cs
│   │   └── Input/
│   │       └── InputHandler.cs
│   ├── ScriptableObjects/
│   │   ├── Weapons/
│   │   ├── Skills/
│   │   ├── Enemies/
│   │   └── Items/
│   ├── Prefabs/
│   │   ├── Player.prefab
│   │   ├── Enemy_Wolf.prefab
│   │   ├── Projectile_Arrow.prefab
│   │   ├── Projectile_Bullet.prefab
│   │   ├── DamageText.prefab
│   │   └── Effects/
│   ├── Animations/
│   │   ├── AnimatorControllers/
│   │   │   ├── PlayerAC.controller
│   │   │   └── EnemyAC.controller
│   │   └── ...
│   ├── Models/
│   │   ├── Characters/
│   │   │   └── Hero.fbx
│   │   ├── Weapons/
│   │   │   ├── Sword.fbx
│   │   │   ├── Bow.fbx
│   │   │   └── Guns/
│   │   └── Enemies/
│   ├── Materials/
│   │   ├── Characters/
│   │   ├── Weapons/
│   │   └── Ground/
│   ├── Scenes/
│   │   ├── MainMenu.unity
│   │   ├── GamePlay.unity
│   │   └── Loading.unity
│   └── Audio/
│       ├── SFX/
│       └── BGM/
└── Packages/
    └── manifest.json
```

---

## 三、关键系统 3D 化对照表

### 3.1 玩家系统

| JS | Unity 3D |
|----|----------|
| `this.x, this.y` | `transform.position` (Vector3，y=0 地面) |
| `this.vx, this.vy` | `Rigidbody.velocity` 或 `CharacterController` |
| `this.rotation` | `transform.rotation` / `transform.right` |
| `initHitbox(15, [...])` | `CapsuleCollider` (角色) + `BoxCollider` (武器) |
| `this.characterImage` | `SkinnedMeshRenderer` (从 FBX 自动获取) |
| `this.characterFrames[ca.frame]` | `Animator.Play("Walk")` / `Animator.SetFloat("Speed")` |
| `renderWeapon(ctx)` | 武器作为子物体，跟随骨骼自动移动 |
| `ctx.rotate(-Math.PI/2)` | `transform.rotation = Quaternion.LookRotation(dir)` |

### 3.2 动画系统

| JS 手动动画 | Unity Mecanim |
|------------|--------------|
| 手动计算 `anim.angle` | Animator Controller 状态机 |
| `windup` → `swing` → `recover` | 动画状态 + Transition（条件触发） |
| `Math.sin(Date.now() / 400) * 0.02` | 呼吸动画在 Blender 中做，或代码控制骨骼缩放 |
| `this.animTimer += dt` | `Animator.SetFloat("AttackProgress", value)` |
| 攻击判定时机 | `AnimationEvent` 在动画帧触发 |

### 3.3 武器系统

| JS | Unity 3D |
|----|----------|
| `this.meleeImage` | 武器 FBX + MeshRenderer |
| 武器位置代码计算 | 骨骼挂载点（WeaponSocket） |
| 后坐力抖动 | 武器子物体局部位置/旋转动画 |
| 枪口火焰位置 | 空子物体 `MuzzleSocket` |
| 弹壳抛射 | 物理刚体 + 碰撞器 |

### 3.4 相机系统

| JS `Renderer` | Unity `CameraController` |
|---------------|-------------------------|
| `Renderer.worldToScreen()` | `Camera.main.WorldToScreenPoint()` |
| 相机平滑跟随 | `Vector3.Lerp` + `Vector3.SmoothDamp` |
| `Camera.triggerShake(4)` | Cinemachine Impulse 或手动位置抖动 |
| 正交投影 | `Camera.orthographic = true` |

---

## 四、Meshy → Unity 工作流详细步骤

### Step 1: Meshy 生成
1. 在 Meshy 中生成角色 + 武器
2. 导出格式选择 **FBX**（包含骨骼 + 动画）
3. 确保动画包含：Idle、Walk、Attack（至少这3个）

### Step 2: Unity 导入设置
1. 拖入 `Assets/_Project/Models/Characters/`
2. 选中 FBX → Inspector → **Model** 标签：
   - Scale Factor: 1（如果模型太大，调为 0.01 或 0.1）
   - Mesh Compression: Off（保持质量）
3. **Rig** 标签：
   - Animation Type: **Humanoid**（如果骨骼标准）或 **Generic**（如果骨骼简单）
   - Avatar Definition: Create From This Model
   - 点击 **Configure...** → 检查骨骼映射 → Apply
4. **Animation** 标签：
   - 确保动画片段被识别（Idle, Walk, Attack）
   - Loop Time: 勾选 Walk、Idle
   - 设置 Root Motion（建议关闭，用代码控制移动）

### Step 3: 场景设置
1. 创建空物体 `Player`
2. 将 FBX 拖入场景作为 `Player` 的子物体（命名为 `Model`）
3. 给 `Player` 添加组件：
   - `Rigidbody`（useGravity = false, constraints = Freeze Rotation X/Z）
   - `CapsuleCollider`（高度匹配角色，方向 Y-Axis）
   - `Animator`（Controller 稍后创建）
   - `PlayerController.cs`（自定义脚本）

### Step 4: 创建 Animator Controller
1. `Assets/_Project/Animations/AnimatorControllers/PlayerAC.controller`
2. 创建状态：Idle、Walk、Attack
3. 创建参数：
   - `float Speed`（0 = idle, 1 = walk）
   - `bool IsAttacking`
   - `trigger AttackTrigger`
4. 创建 Transition：
   - Idle → Walk: 条件 `Speed > 0.1`
   - Walk → Idle: 条件 `Speed < 0.1`
   - Any State → Attack: 条件 `AttackTrigger`（trigger）
   - Attack → Idle: 退出时间 1.0（动画播放完自动返回）
5. 给 `Player` 的 Animator 组件指定这个 Controller

### Step 5: 武器挂载
1. 在 Hierarchy 中找到 `Model/Armature/.../RightHand`（手掌骨骼）
2. 在 `RightHand` 下创建空物体 `WeaponSocket`
3. 调整 `WeaponSocket` 的本地位置，让武器在手中自然握持
4. 将武器 FBX 拖入 `WeaponSocket` 下

### Step 6: 相机设置
1. 选中 Main Camera
2. Transform Position: `(0, 15, -10)`（根据场景调整）
3. Transform Rotation: `(60, 45, 0)`（60°俯视 + 45°侧偏）
4. Camera → Projection: **Orthographic**
5. Camera → Size: 5（根据角色大小调整）
6. 添加 `CameraController.cs` 脚本，目标指向 Player

---

## 五、9 阶段实施计划（3D 版）

### Phase 0: Unity 项目初始化 + 包安装（1-2天）

**目标**: 新建项目，安装必要包，导入第一个角色模型，能在场景中显示。

**步骤**:
1. 创建 3D (Built-in) 项目
2. 安装 Package Manager 包:
   - New Input System
   - Cinemachine (可选，用于相机震动)
3. 创建 `_Project` 文件夹结构
4. 导入 Meshy 角色 FBX
5. 配置 FBX Import Settings（Rig = Humanoid/Generic）
6. 拖入场景，检查模型显示正常
7. 创建基础 Animator Controller（Idle + Walk 状态）
8. 设置相机（Orthographic, 60°俯视）

**产出**: 项目能运行，角色 idle 动画在场景中播放。

---

### Phase 1: 核心框架 — 输入 + 玩家移动 + 相机跟随（2-3天）

**目标**: 玩家 WASD 移动，角色旋转朝向移动方向，相机跟随。

**脚本**:
- `InputHandler.cs` — 读取 New Input System，输出 `Vector2 moveInput`, `Vector2 mousePosition`, `bool attackPressed`
- `PlayerController.cs` — 移动逻辑、朝向旋转、动画参数传递
- `CameraController.cs` — 平滑跟随 + 边界约束

**关键代码片段**:
```csharp
// PlayerController.cs - 移动和旋转
void Update()
{
    Vector2 input = InputHandler.MoveInput;
    Vector3 moveDir = new Vector3(input.x, 0, input.y);
    
    // 移动
    rb.velocity = moveDir * moveSpeed;
    
    // 旋转朝向移动方向（或鼠标方向）
    if (moveDir.magnitude > 0.1f)
    {
        transform.rotation = Quaternion.LookRotation(moveDir);
    }
    
    // 传递动画参数
    animator.SetFloat("Speed", moveDir.magnitude);
}
```

**产出**: 角色能在场景中移动，面朝移动方向，Walk/Idle 动画自动切换。

---

### Phase 2: 实体系统 + 伤害框架（2-3天）

**目标**: 建立 IDamageable 接口，玩家和敌人都能受伤/死亡。

**脚本**:
- `IDamageable.cs` — 接口
- `Damageable.cs` — 实现：HP 管理、受伤、死亡事件、无敌帧
- `PlayerStats.cs` — 属性系统（STR/DEX/INT/CON/WIS/LUCK）

**产出**: 角色有 HP，受伤会触发事件，死亡会销毁。

---

### Phase 3: 武器系统（3-4天）

**目标**: 近战/远程攻击正常工作，武器挂载在骨骼上。

**脚本**:
- `WeaponData.cs` — ScriptableObject 配置
- `WeaponBase.cs` — 抽象基类
- `MeleeWeapon.cs` — 范围检测（OverlapBox/OverlapSphere）
- `RangedWeapon.cs` — 发射投射物
- `Projectile.cs` — 飞行、碰撞检测
- `WeaponHolder.cs` — 管理武器挂载点切换

**关键设置**:
- 在手掌骨骼下创建 `WeaponSocket`
- 武器 Prefab 挂载到 Socket 下
- 攻击动画使用 `AnimationEvent` 在特定帧触发伤害判定

**产出**: 玩家可以攻击，近战有范围判定，远程发射投射物，有伤害飘字。

---

### Phase 4: 敌人系统（2-3天）

**目标**: AI 敌人能生成、追踪、攻击、死亡。

**脚本**:
- `EnemyData.cs` — ScriptableObject
- `EnemyController.cs` — AI 状态机（Idle/Chase/Attack/Dead）
- `EnemyAI.cs` — 行为逻辑（寻路、攻击冷却）
- `EnemySpawner.cs` — 基于玩家位置的生成器

**AI 状态机**:
```csharp
public enum EnemyState { Idle, Chase, Attack, Dead }

void Update()
{
    switch (currentState)
    {
        case EnemyState.Idle:
            if (PlayerInDetectionRange()) ChangeState(Chase);
            break;
        case EnemyState.Chase:
            MoveTowards(Player.position);
            if (PlayerInAttackRange()) ChangeState(Attack);
            if (!PlayerInDetectionRange()) ChangeState(Idle);
            break;
        case EnemyState.Attack:
            if (attackCooldown <= 0) PerformAttack();
            if (!PlayerInAttackRange()) ChangeState(Chase);
            break;
    }
}
```

**产出**: 敌人自动生成，追玩家，攻击，死亡掉金币。

---

### Phase 5: 技能系统（2-3天）

**目标**: 被动技能有属性加成，主动技能可触发。

**脚本**:
- `SkillData.cs` — ScriptableObject
- `SkillBase.cs` — 抽象类
- `SkillManager.cs` — 单例，管理所有技能经验/等级
- 各技能实现（SwordMastery, DashAttack, Whirlwind, CriticalStrike 等）

**产出**: 技能面板可查看，击杀/暴击获得经验，升级有属性加成。

---

### Phase 6: UI 系统（3-4天）

**目标**: UGUI 替代 HTML/CSS，所有面板正常工作。

**UI 清单**:
- HUD: HP/ stamina / EXP 条（Slider + Image）
- 伤害飘字（TextMeshPro + DOTween/Animator）
- 背包（GridLayoutGroup + 拖拽）
- 装备栏（拖拽 + 槽位限制）
- 技能面板（ScrollView + 经验条）
- 商店（购买/出售）
- 图鉴（解锁状态）

**产出**: 所有 UI 可交互，显示正常。

---

### Phase 7: 特效 + 音频 + 相机震动（2-3天）

**目标**: 完整的视听反馈。

- **特效**: 枪口火焰（ParticleSystem）、血雾、弹壳（刚体物理）、灰尘
- **音频**: AudioManager + AudioMixer（SFX/BGM/UI 分组）
- **相机震动**: Cinemachine Impulse（射击/暴击时触发）
- **屏幕效果**: 暴击时屏幕闪光（Image 覆盖 + 透明度动画）

**产出**: 游戏有完整视听反馈。

---

### Phase 8: 世界生成 + 关卡（1-2天）

**目标**: 游戏世界有地形、墙壁、传送门。

- **地面**: 使用 Plane 或 Quad 拼接，或 Terrain（简化版）
- **墙壁**: 3D 模型 + Collider
- **Tilemap 方案**: 如果要做网格化地面，可用 3D Tilemap 或预制体拼接
- **传送门**: Trigger Collider + SceneManager.LoadScene()

**产出**: 完整的游戏世界。

---

### Phase 9: 存档 + 设置（1-2天）

**目标**: 游戏进度可保存。

- **SaveSystem**: JSON 序列化（JsonUtility 或 Newtonsoft.Json）
- 保存内容: 玩家属性、装备、技能等级、背包、世界状态
- **SettingsManager**: 音量、画质、按键绑定（PlayerPrefs）

**产出**: 游戏可存档/读档。

---

## 六、关键脚本模板（Phase 1 用）

### 6.1 PlayerController.cs

```csharp
using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(Rigidbody))]
[RequireComponent(typeof(Animator))]
public class PlayerController : MonoBehaviour
{
    [Header("Movement")]
    public float moveSpeed = 5f;
    public float rotationSpeed = 15f;
    
    [Header("References")]
    public Transform modelTransform; // 模型子物体，用于旋转
    public Animator animator;
    public Rigidbody rb;
    
    private Vector2 moveInput;
    private Vector2 mouseScreenPos;
    
    void Awake()
    {
        if (rb == null) rb = GetComponent<Rigidbody>();
        if (animator == null) animator = GetComponentInChildren<Animator>();
        if (modelTransform == null) modelTransform = transform;
    }
    
    void OnEnable()
    {
        // New Input System 绑定
        var input = new PlayerInputActions();
        input.Player.Move.performed += ctx => moveInput = ctx.ReadValue<Vector2>();
        input.Player.Move.canceled += ctx => moveInput = Vector2.zero;
        input.Player.Attack.performed += ctx => OnAttack();
        input.Enable();
    }
    
    void FixedUpdate()
    {
        // 移动
        Vector3 moveDir = new Vector3(moveInput.x, 0, moveInput.y);
        rb.velocity = moveDir * moveSpeed;
        
        // 旋转：面朝鼠标方向（或移动方向）
        Ray ray = Camera.main.ScreenPointToRay(Mouse.current.position.ReadValue());
        if (Physics.Raycast(ray, out RaycastHit hit, 100f, groundLayer))
        {
            Vector3 lookDir = hit.point - transform.position;
            lookDir.y = 0;
            if (lookDir.magnitude > 0.1f)
            {
                Quaternion targetRot = Quaternion.LookRotation(lookDir);
                modelTransform.rotation = Quaternion.Slerp(modelTransform.rotation, targetRot, rotationSpeed * Time.fixedDeltaTime);
            }
        }
        
        // 动画参数
        animator.SetFloat("Speed", moveDir.magnitude);
    }
    
    void OnAttack()
    {
        animator.SetTrigger("AttackTrigger");
    }
}
```

### 6.2 Input Actions 资产设置

```
Action Map: "Player"
  - Move: Value → Vector2 → WASD / Arrow Keys / Left Stick
  - Attack: Button → Mouse Left Button / Gamepad Button West
  - Sprint: Button → Shift / Left Trigger
  - Dodge: Button → Space / Right Trigger
  - Interact: Button → E / Gamepad Button North
```

### 6.3 CameraController.cs

```csharp
using UnityEngine;

public class CameraController : MonoBehaviour
{
    public Transform target;
    public float smoothSpeed = 0.125f;
    public Vector3 offset = new Vector3(0, 12, -8);
    
    void LateUpdate()
    {
        if (target == null) return;
        
        Vector3 desiredPosition = target.position + offset;
        Vector3 smoothedPosition = Vector3.Lerp(transform.position, desiredPosition, smoothSpeed);
        transform.position = smoothedPosition;
        
        // 相机始终看向目标
        transform.LookAt(target);
    }
}
```

---

## 七、下一步行动

请确认以下信息，然后我从 **Phase 0** 开始给你截图级操作指南：

1. ✅ Unity 2022.3.62f3c1 LTS 已安装
2. ❌ 没有安装任何包
3. ✅ 采用 3D 模型 + 正交相机 + 角色旋转方案
4. 待确认：
   - Meshy 角色 FBX 是否已生成？（能否先导出 1 个测试用）
   - 相机角度偏好：45° 还是 60° 俯视？
   - 是否已购买/安装 DOTween（可选）？

确认后我立即开始 **Phase 0: 项目初始化 + 包安装 + 第一个模型导入** 的详细步骤。
