# Unity 2D + 3D 角色 — 开发步骤 (Phase 0)

> 方案：Unity 2D 项目，使用 3D 角色模型（FBX），正交相机俯视
> Unity 版本：2022.3.62f3c1 LTS
> 日期：由运行时确定

---

## Step 1: 创建 Unity 2D 项目

1. 打开 **Unity Hub**
2. 点击左侧 **Projects** → 点击右上角 **New project**
3. 在弹窗中：
   - 顶部选择 **2D (Built-in Render Pipeline)**（⚠️ 一定要选 2D，不是 3D）
   - 项目名称：`InfinityLoop`
   - 位置：选你的工作目录（如 `D:\UnityProjects\`）
   - 点击 **Create project**
4. 等待 Unity 打开（第一次可能需要几分钟）

---

## Step 2: 安装 New Input System（详细步骤）

New Input System 是 Unity 现代化的输入系统，比旧版 `Input.GetAxis` 更灵活，支持键盘、手柄、触屏等。

### 2.1 打开 Package Manager

1. 顶部菜单 → **Window → Package Manager**
2. 等待窗口加载（左下角有进度条）

### 2.2 搜索并安装

1. 在 Package Manager 窗口左上角：
   - 找到 **Packages:** 下拉框
   - 选择 **Unity Registry**（默认是 "In Project"，要选成 Unity Registry 才能搜到）
2. 在右侧搜索框输入：`Input System`
3. 等待搜索结果，找到 **Input System**（作者 Unity Technologies）
4. 点击选中它
5. 点击右下角 **Install** 按钮
6. 等待安装完成（进度条走完后，按钮变成 "Remove"）

### 2.3 启用 New Input System（关键！）

1. 安装完成后，Unity 会弹出一个对话框：
   > "A restart is required to enable the new input system backend. Do you want to restart now?"
   
   点击 **Yes**
2. Unity 编辑器会关闭并重新打开（等 30-60 秒）

### 2.4 验证安装成功

1. 重新打开后，看 Project 窗口 → Packages 文件夹里是否有 **Input System**
2. 顶部菜单 → **Edit → Project Settings** → 左侧找到 **Player** → 拉到最下方 **Configuration** → 看到 **Active Input Handling** 应该是 **Input System Package**（或 Both）

---

## Step 3: 创建项目文件夹结构

在 Unity 底部 **Project** 窗口中操作：

1. 右键点击 **Assets** → **Create → Folder** → 命名为 `_Project`
2. 双击进入 `_Project`，继续创建以下文件夹：

   在 `_Project` 下右键 → **Create → Folder**：
   - `Scripts`
   - `ScriptableObjects`
   - `Prefabs`
   - `Animations`
   - `Models`
   - `Materials`
   - `Scenes`
   - `Audio`
   - `Sprites`（放2D背景、地面等）

3. 在 `Scripts` 下创建文件夹：
   - `Core`
   - `Entities`
   - `Combat`
   - `Weapons`
   - `Skills`
   - `Items`
   - `UI`
   - `World`
   - `Effects`
   - `Audio`
   - `Input`

4. 在 `ScriptableObjects` 下创建文件夹：
   - `Weapons`
   - `Skills`
   - `Enemies`
   - `Items`

5. 在 `Animations` 下创建文件夹：
   - `AnimatorControllers`

6. 在 `Models` 下创建文件夹：
   - `Characters`
   - `Weapons`
   - `Enemies`

最终结构：
```
Assets/
└── _Project/
    ├── Scripts/
    │   ├── Core/
    │   ├── Entities/
    │   ├── Combat/
    │   ├── Weapons/
    │   ├── Skills/
    │   ├── Items/
    │   ├── UI/
    │   ├── World/
    │   ├── Effects/
    │   ├── Audio/
    │   └── Input/
    ├── ScriptableObjects/
    │   ├── Weapons/
    │   ├── Skills/
    │   ├── Enemies/
    │   └── Items/
    ├── Prefabs/
    ├── Animations/
    │   └── AnimatorControllers/
    ├── Models/
    │   ├── Characters/
    │   ├── Weapons/
    │   └── Enemies/
    ├── Materials/
    ├── Scenes/
    ├── Audio/
    └── Sprites/
```

---

## Step 4: 导入 Meshy 角色 FBX

### 4.1 复制文件

1. 在你的电脑中找到 Meshy 导出的 `.fbx` 文件
2. 复制到：`Assets/_Project/Models/Characters/`（直接拖入 Unity 的 Project 窗口也可以）

### 4.2 配置 FBX Import Settings

1. 在 Unity **Project 窗口**中，找到 `Assets/_Project/Models/Characters/你的角色.fbx`
2. 点击选中它
3. 看右侧 **Inspector 窗口**，会显示 FBX 导入设置

#### Model 标签（第一个标签）：
- **Scale Factor**: 如果模型太大或太小，调整这个值。建议先试 `1`，如果模型在场景中太大，改成 `0.01` 或 `0.1`
- **Mesh Compression**: 保持 **Off**（不压缩，保持质量）
- 其他保持默认
- 点击 **Apply**

#### Rig 标签（第二个标签）：
- **Animation Type**: 选择 **Generic**（如果 Meshy 骨骼简单，只有几根骨头）或 **Humanoid**（如果骨骼完整，有头、手臂、腿等）
  - 如果不知道，先选 **Generic**，后面看动画能不能正常播放
- **Avatar Definition**: **Create From This Model**
- 点击 **Apply**
- 如果选了 Humanoid，点击 **Configure...** 检查骨骼映射：
  - 绿色 = 自动映射成功
  - 红色 = 缺失，手动拖动骨骼到对应位置
  - 点击 **Done** → **Apply**

#### Animation 标签（第三个标签）：
- 在 **Clips** 列表中，应该能看到 Meshy 导出的动画（如 `Idle`, `Walk`）
- 点击每个动画片段：
  - **Idle**: 勾选 **Loop Time** → **Loop Pose**（如果有）
  - **Walk**: 勾选 **Loop Time** → **Loop Pose**
  - 其他动画（Attack 等）按需勾选 Loop Time
- 点击 **Apply**

### 4.3 拖入场景

1. 把 `你的角色.fbx` 从 Project 窗口拖到 **Hierarchy 窗口**（或者场景视图）
2. 场景中应该出现你的角色模型
3. 如果看不见或太大：
   - 选中模型 → Inspector → Transform
   - 调整 **Position** 到 `(0, 0, 0)`
   - 调整 **Scale** 到合适大小（如 `(0.01, 0.01, 0.01)` 如果模型太大）

---

## Step 5: 创建 Player 父物体

**重要**：不要把脚本直接挂在 FBX 模型上，而是创建一个父物体来管理。

1. 在 **Hierarchy** 窗口中右键 → **Create Empty** → 命名为 `Player`
2. 把场景中的 `你的角色` 模型拖到 `Player` 下面，作为子物体
3. 选中子物体（模型），重命名为 `Model`
4. 调整 `Model` 的 Transform：
   - Position: `(0, 0, 0)`（相对父物体居中）
   - Rotation: `(0, 0, 0)`
   - Scale: 根据模型大小调整，建议先保持 `(1, 1, 1)`，如果模型太大改 `(0.01, 0.01, 0.01)`

### 添加碰撞器（2D）

虽然模型是 3D 的，但物理用 2D 碰撞器：

1. 选中 `Player`（父物体）
2. Inspector → **Add Component** → 搜索 **Capsule Collider 2D**
3. 调整碰撞器大小：
   - **Size**: 根据角色调整（如 `X=1, Y=2`）
   - **Offset**: 让碰撞器对齐角色脚底
4. 在 **Scene** 视图中按 **G** 键（或点击工具栏小手下面的移动按钮），拖动碰撞器手柄，确保它包围角色

### 添加刚体（2D）

1. 选中 `Player`（父物体）
2. Inspector → **Add Component** → 搜索 **Rigidbody 2D**
3. 设置：
   - **Gravity Scale**: `0`（俯视角游戏不需要重力）
   - **Constraints** → **Freeze Rotation**: 勾选 **Z**（防止角色被撞后旋转）

### 添加 Animator

1. 选中 `Player`（父物体）
2. Inspector → **Add Component** → 搜索 **Animator**
3. 暂时空着，Step 6 创建 Controller 后再填

---

## Step 6: 创建 Animator Controller

1. 在 Project 窗口中，`Assets/_Project/Animations/AnimatorControllers/` 右键
2. **Create → Animator Controller** → 命名为 `PlayerAC`
3. 双击 `PlayerAC`，打开 **Animator 窗口**（如果弹出了新窗口，把它停靠在 Scene 视图旁边）

### 创建动画状态

1. 在 Animator 窗口的空白区域 **右键** → **Create State → Empty**
2. 重命名为 `Idle`（点击名字改）
3. 再右键 → **Create State → Empty** → 重命名为 `Walk`
4. 再右键 → **Create State → Empty** → 重命名为 `Attack`
5. 右键 `Idle` → **Set as Layer Default State**（Idle 变成黄色，表示默认状态）

### 创建参数

1. 在 Animator 窗口左下角，点击 **Parameters** 标签
2. 点击 **+** 按钮：
   - 选择 **Float** → 命名为 `Speed`
   - 选择 **Trigger** → 命名为 `AttackTrigger`

### 创建状态切换（Transition）

**Idle → Walk（当 Speed > 0.1）**：
1. 右键 `Idle` → **Make Transition**
2. 鼠标拖到 `Walk` 上，松开
3. 点击这条白色箭头（Transition）
4. 在 Inspector 中：
   - **Has Exit Time**: 取消勾选（☐）
   - **Transition Duration**: 改成 `0.1`（过渡时间 0.1 秒）
   - 点击 **+** 在 **Conditions** 下添加条件：
     - `Speed` **Greater** `0.1`

**Walk → Idle（当 Speed < 0.1）**：
1. 右键 `Walk` → **Make Transition** → 拖到 `Idle`
2. 点击箭头
3. Inspector：
   - **Has Exit Time**: 取消勾选
   - **Transition Duration**: `0.1`
   - Conditions: `Speed` **Less** `0.1`

**Any State → Attack（当触发 AttackTrigger）**：
1. 右键空白区域 → **Make Transition** → 拖到 `Attack`
2. 点击箭头
3. Inspector：
   - **Has Exit Time**: 取消勾选
   - **Transition Duration**: `0.05`
   - Conditions: `AttackTrigger`

**Attack → Idle（播放完自动返回）**：
1. 右键 `Attack` → **Make Transition** → 拖到 `Idle`
2. 点击箭头
3. Inspector：
   - **Has Exit Time**: 勾选（☑）
   - **Exit Time**: `0.95`（播放 95% 后退出）
   - **Transition Duration**: `0.1`
   - 不需要额外条件

### 绑定动画片段

1. 回到 Project 窗口，找到 `你的角色.fbx`
2. 点击旁边的小箭头展开，应该能看到动画片段（如 `Idle`, `Walk`）
3. 把 `Idle` 动画片段拖到 Animator 窗口的 `Idle` 状态上
4. 把 `Walk` 动画片段拖到 `Walk` 状态上
5. 把 `Attack` 动画片段拖到 `Attack` 状态上

### 绑定到 Player

1. 选中 **Hierarchy** 中的 `Player`
2. 在 Inspector 中，找到 **Animator** 组件
3. 把 Project 窗口中的 `PlayerAC` 拖到 **Controller** 字段上

---

## Step 7: 设置相机

1. 在 **Hierarchy** 中找到 **Main Camera**
2. 选中它，Inspector 中设置：

   **Transform**：
   - Position: `(0, 15, -10)`
   - Rotation: `(60, 45, 0)`（60度俯视，45度侧偏）

   **Camera 组件**：
   - **Projection**: **Orthographic**（正交）
   - **Size**: `5`（根据角色大小调整，如果角色太小就改大，如 8 或 10）
   - **Background**: 点击颜色选择器，选一个合适的颜色（如雪地用浅蓝色 `#87CEEB`）
   - **Clear Flags**: Solid Color

3. 点击 Scene 视图的 **2D 按钮**（取消 2D 模式，确保是 3D 视图），从上方看角色，调整相机位置让角色在画面中央

---

## Step 8: 创建地面（参考平面）

1. Hierarchy 右键 → **2D Object → Sprite** → 命名为 `Ground`
2. 如果看不见，可能需要创建 Sprite：
   - 更简单的方法：右键 → **Create Empty** → 命名为 `Ground`
   - 添加 **Sprite Renderer** 组件（Add Component → Sprite Renderer）
   - 创建临时 Sprite：`Assets/_Project/Sprites/` 右键 → **Create → Sprite** → 命名为 `WhitePixel`
   - 选中 `WhitePixel` → Inspector → 点击 **Sprite Editor** → 设置大小 → 保存
   - 或者在 Photoshop 中创建一个 1x1 像素的白色 PNG，导入到 Sprites 文件夹
3. 选中 `Ground` 的 Sprite Renderer，把 `WhitePixel` 拖到 **Sprite** 字段
4. 设置颜色：Sprite Renderer 的 **Color** → 选一个地面颜色（如草地 `#2d4a1e`）
5. Transform Scale: `(100, 100, 1)`（让地面足够大）
6. Transform Position: `(0, 0, 0)`

或者**更简单的做法**：
1. Hierarchy 右键 → **3D Object → Plane** → 命名为 `Ground`
2. 这会在 3D 空间中创建一个平面
3. 创建材质：`Assets/_Project/Materials/` 右键 → **Create → Material** → 命名为 `GroundMat`
4. 选中 `GroundMat` → Inspector → **Albedo** 颜色 → 选地面颜色
5. 把 `GroundMat` 拖到 `Ground` 上

---

## Step 9: 创建 Input Actions 资产

1. 在 `Assets/_Project/Scripts/Input/` 右键 → **Create → Input Actions**
2. 命名为 `PlayerInputActions`
3. 双击打开（会弹出一个新窗口）

### 配置 Action Map

1. 默认已经有了 `Player` Action Map，保留它
2. 删除默认的 `Fire` 动作（点击 `Fire` → 右键 → **Delete Action**）

### 添加 Move 动作

1. 点击 **+**（Add Action）→ 命名为 `Move`
2. 右侧 **Action Type**: `Value`
3. **Control Type**: `Vector2`
4. 在 `Move` 下点击 **+**（Add Binding）→ 选择 **2D Vector**
5. 展开 2D Vector，点击每个方向绑定按键：
   - Up: `W`（Keyboard）
   - Down: `S`（Keyboard）
   - Left: `A`（Keyboard）
   - Right: `D`（Keyboard）
6. 再点击 **+**（Add Binding）→ 选择 **2D Vector** → 绑定方向键（Arrow Keys）

### 添加 Attack 动作

1. 点击 **+** → 命名为 `Attack`
2. Action Type: `Button`
3. 点击 **+**（Add Binding）→ 在 **Path** 中选择：`Mouse / Left Button`

### 添加其他动作（可选）

- `Sprint`: Button → `Shift`（Keyboard）
- `Dodge`: Button → `Space`（Keyboard）

### 保存并生成 C# 代码

1. 点击左上角 **软盘图标**（Save Asset）或按 **Ctrl + S**
2. 在 Inspector 中（选中 `PlayerInputActions`）：
   - 勾选 **Generate C# Class**
   - 点击 **Apply**
3. Unity 会自动生成 `PlayerInputActions.cs`（在同级目录）

---

## Step 10: 创建 PlayerController 脚本

1. 在 `Assets/_Project/Scripts/Entities/` 右键 → **Create → C# Script**
2. 命名为 `PlayerController`
3. 双击打开（会用 Visual Studio 或 VS Code 打开）
4. 粘贴以下代码（完全替换默认代码）：

```csharp
using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(Rigidbody2D))]
[RequireComponent(typeof(Animator))]
public class PlayerController : MonoBehaviour
{
    [Header("Movement")]
    public float moveSpeed = 5f;
    public float rotationSpeed = 15f;
    
    [Header("References")]
    public Transform modelTransform; // 模型子物体，用于旋转
    
    private Vector2 moveInput;
    private PlayerInputActions inputActions;
    private Rigidbody2D rb;
    private Animator animator;
    
    void Awake()
    {
        rb = GetComponent<Rigidbody2D>();
        animator = GetComponent<Animator>();
        
        if (modelTransform == null)
            modelTransform = transform.Find("Model");
    }
    
    void OnEnable()
    {
        inputActions = new PlayerInputActions();
        
        inputActions.Player.Move.performed += ctx => moveInput = ctx.ReadValue<Vector2>();
        inputActions.Player.Move.canceled += ctx => moveInput = Vector2.zero;
        inputActions.Player.Attack.performed += ctx => OnAttack();
        
        inputActions.Enable();
    }
    
    void OnDisable()
    {
        inputActions?.Disable();
    }
    
    void FixedUpdate()
    {
        // 移动
        Vector2 moveDir = moveInput.normalized;
        rb.velocity = moveDir * moveSpeed;
        
        // 旋转：面朝鼠标方向（或移动方向）
        Vector3 mousePos = Mouse.current.position.ReadValue();
        Ray ray = Camera.main.ScreenPointToRay(mousePos);
        
        // 在 Y=0 平面上求鼠标位置
        Plane groundPlane = new Plane(Vector3.up, Vector3.zero);
        if (groundPlane.Raycast(ray, out float enter))
        {
            Vector3 hitPoint = ray.GetPoint(enter);
            Vector3 lookDir = hitPoint - transform.position;
            lookDir.y = 0;
            
            if (lookDir.magnitude > 0.1f)
            {
                Quaternion targetRot = Quaternion.LookRotation(lookDir);
                modelTransform.rotation = Quaternion.Slerp(
                    modelTransform.rotation, targetRot, rotationSpeed * Time.fixedDeltaTime);
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

5. 保存文件（Ctrl + S）
6. 回到 Unity，等待编译完成（底部有进度条）

---

## Step 11: 挂载脚本并运行

### 挂载脚本

1. 在 **Hierarchy** 中选中 `Player`
2. 把 `PlayerController` 脚本从 Project 窗口拖到 Inspector 底部（或点击 Add Component → 搜索 PlayerController）
3. 在 Inspector 中检查 PlayerController 的字段：
   - **Model Transform**: 应该自动识别到 `Model` 子物体，如果没有，手动把 `Model` 从 Hierarchy 拖到这个字段

### 设置 Layer

1. 顶部菜单 → **Edit → Project Settings → Tags and Layers**
2. 在 **Layers** 中找到 **User Layer 8**（或任意空位）
3. 命名为 `Ground`
4. 选中 `Ground` 物体 → Inspector → **Layer** 下拉框 → 选择 `Ground`

### 运行测试

1. 点击顶部中间的 **▶ Play** 按钮
2. 预期效果：
   - 角色在场景中央显示，播放 Idle 动画
   - 按 WASD 移动，角色面朝鼠标方向
   - 动画在 Idle 和 Walk 之间切换
   - 按鼠标左键，播放 Attack 动画
   - 相机跟随玩家

3. 如果没有跟随，在 Camera 上添加脚本（后续步骤）

---

## Step 12: 添加相机跟随脚本（可选，如果相机不动）

1. `Assets/_Project/Scripts/World/` 右键 → **Create → C# Script** → 命名为 `CameraFollow`
2. 粘贴代码：

```csharp
using UnityEngine;

public class CameraFollow : MonoBehaviour
{
    public Transform target;
    public float smoothSpeed = 0.125f;
    public Vector3 offset = new Vector3(0, 15, -10);
    
    void LateUpdate()
    {
        if (target == null) return;
        
        Vector3 desiredPosition = target.position + offset;
        Vector3 smoothedPosition = Vector3.Lerp(transform.position, desiredPosition, smoothSpeed);
        transform.position = smoothedPosition;
        
        transform.LookAt(target);
    }
}
```

3. 保存
4. 把 `CameraFollow` 拖到 **Main Camera** 上
5. 把 `Player` 从 Hierarchy 拖到 CameraFollow 的 **Target** 字段

---

## 完成检查清单

完成后，请截图或告诉我：

- [ ] 项目已创建，是 2D (Built-in)
- [ ] New Input System 已安装并启用
- [ ] 文件夹结构已创建
- [ ] Meshy FBX 已导入，模型在场景中可见
- [ ] Player 父物体 + Model 子物体结构正确
- [ ] CapsuleCollider2D 和 Rigidbody2D 已添加
- [ ] Animator Controller 已创建并绑定
- [ ] 相机设置为 Orthographic，Rotation (60, 45, 0)
- [ ] Input Actions 已创建并保存
- [ ] PlayerController 脚本已挂载
- [ ] 点击 Play 后角色能移动和攻击

**每完成一步，请告诉我进展或截图。遇到任何问题随时提问。**
