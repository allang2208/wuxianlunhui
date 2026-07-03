# Unity 2D + 3D 角色 — 开发步骤 (Phase 0) 中文完整版

> 方案：Unity 2D 项目，使用 3D 角色模型（FBX），正交相机俯视
> Unity 版本：2022.3.62f3c1 LTS（中文界面）
> 渲染管线：内置渲染管线（2D）
> 输入：新输入系统（New Input System）
> 动画：动画器（Mecanim）

---

## 第一步：创建 Unity 2D 项目

1. 打开 **Unity Hub**（Unity 启动器）
2. 点击左侧 **项目** → 点击右上角 **新建项目**
3. 在弹窗中：
   - 顶部选择 **2D（内置渲染管线）**（⚠️ 一定要选 2D，不是 3D）
   - 项目名称：`无限轮回`（或你喜欢的名字）
   - 位置：选你的工作目录（如 `D:\Unity项目\`）
   - 点击 **创建项目**
4. 等待 Unity 编辑器打开（第一次可能需要几分钟）

---

## 第二步：安装新输入系统（New Input System）

### 2.1 打开包管理器

1. 顶部菜单栏 → **窗口 → 包管理器**（Window → Package Manager）
2. 等待窗口加载（左下角有进度条）

### 2.2 搜索并安装

1. 在包管理器窗口左上角：
   - 找到 **包：** 下拉框
   - 选择 **Unity 注册表**（默认是 "项目中"，要选成 Unity 注册表才能搜到）
2. 在右侧搜索框输入：`Input System`
3. 等待搜索结果，找到 **Input System**（作者 Unity Technologies）
4. 点击选中它
5. 点击右下角 **安装** 按钮
6. 等待安装完成（进度条走完后，按钮变成 "移除"）

### 2.3 启用新输入系统（关键！）

1. 安装完成后，Unity 会弹出一个对话框：
   > "需要重新启动才能启用新的输入系统后端。要立即重启吗？"
   
   点击 **是**
2. Unity 编辑器会关闭并重新打开（等 30-60 秒）

### 2.4 验证安装成功

1. 重新打开后，看底部 **项目** 窗口 → 包 文件夹里是否有 **Input System**
2. 顶部菜单 → **编辑 → 项目设置** → 左侧找到 **Player（玩家）** → 拉到最下方 **其他设置** → **活动输入处理** 应该是 **输入系统包**（或两者）

---

## 第三步：创建项目文件夹结构

在 Unity 底部 **项目** 窗口中操作：

1. 右键点击 **Assets（资源）** → **创建 → 文件夹** → 命名为 `_Project`
2. 双击进入 `_Project`，继续创建以下文件夹：

   在 `_Project` 下右键 → **创建 → 文件夹**：
   - `Scripts`（脚本）
   - `ScriptableObjects`（可编程对象）
   - `Prefabs`（预制体）
   - `Animations`（动画）
   - `Models`（模型）
   - `Materials`（材质）
   - `Scenes`（场景）
   - `Audio`（音频）
   - `Sprites`（精灵图，放2D背景、地面等）

3. 在 `Scripts` 下创建文件夹：
   - `Core`（核心）
   - `Entities`（实体）
   - `Combat`（战斗）
   - `Weapons`（武器）
   - `Skills`（技能）
   - `Items`（物品）
   - `UI`（界面）
   - `World`（世界）
   - `Effects`（特效）
   - `Audio`（音频）
   - `Input`（输入）

4. 在 `ScriptableObjects` 下创建文件夹：
   - `Weapons`（武器）
   - `Skills`（技能）
   - `Enemies`（敌人）
   - `Items`（物品）

5. 在 `Animations` 下创建文件夹：
   - `AnimatorControllers`（动画控制器）

6. 在 `Models` 下创建文件夹：
   - `Characters`（角色）
   - `Weapons`（武器）
   - `Enemies`（敌人）

最终结构：
```
Assets（资源）/
└── _Project/
    ├── Scripts（脚本）/
    │   ├── Core（核心）/
    │   ├── Entities（实体）/
    │   ├── Combat（战斗）/
    │   ├── Weapons（武器）/
    │   ├── Skills（技能）/
    │   ├── Items（物品）/
    │   ├── UI（界面）/
    │   ├── World（世界）/
    │   ├── Effects（特效）/
    │   ├── Audio（音频）/
    │   └── Input（输入）/
    ├── ScriptableObjects（可编程对象）/
    │   ├── Weapons（武器）/
    │   ├── Skills（技能）/
    │   ├── Enemies（敌人）/
    │   └── Items（物品）/
    ├── Prefabs（预制体）/
    ├── Animations（动画）/
    │   └── AnimatorControllers（动画控制器）/
    ├── Models（模型）/
    │   ├── Characters（角色）/
    │   ├── Weapons（武器）/
    │   └── Enemies（敌人）/
    ├── Materials（材质）/
    ├── Scenes（场景）/
    ├── Audio（音频）/
    └── Sprites（精灵图）/
```

---

## 第四步：导入 Meshy 角色模型（FBX）

### 4.1 复制文件

1. 在你的电脑中找到 Meshy 导出的 `.fbx` 文件
2. 复制到项目文件夹：`Assets/_Project/Models/Characters/`（直接拖入 Unity 的 项目 窗口也可以）

### 4.2 配置 FBX 导入设置

1. 在 Unity **项目** 窗口中，找到 `Assets/_Project/Models/Characters/你的角色.fbx`
2. 点击选中它
3. 看右侧 **检查器** 窗口，会显示 FBX 导入设置

#### 模型 标签（第一个标签）：
- **缩放系数**：如果模型太大或太小，调整这个值。建议先试 `1`，如果模型在场景中太大，改成 `0.01` 或 `0.1`
- **网格压缩**：保持 **关闭**（不压缩，保持质量）
- 其他保持默认
- 点击 **应用**

#### 骨骼 标签（第二个标签）：
- **动画类型**：选择 **通用**（如果 Meshy 骨骼简单，只有几根骨头）或 **人形**（如果骨骼完整，有头、手臂、腿等）
  - 如果不知道，先选 **通用**，后面看动画能不能正常播放
- **Avatar 定义**：**从此模型创建**
- 点击 **应用**
- 如果选了 人形，点击 **配置...** 检查骨骼映射：
  - 绿色 = 自动映射成功
  - 红色 = 缺失，手动拖动骨骼到对应位置
  - 点击 **完成** → **应用**

#### 动画 标签（第三个标签）：
- 在 **片段** 列表中，应该能看到 Meshy 导出的动画（如 `Idle`, `Walk`）
- 点击每个动画片段：
  - **待机**：勾选 **循环时间** → **循环姿势**（如果有）
  - **行走**：勾选 **循环时间** → **循环姿势**
  - 其他动画（攻击 等）按需勾选 循环时间
- 点击 **应用**

### 4.3 拖入场景

1. 把 `你的角色.fbx` 从 项目 窗口拖到 **层级** 窗口（或者场景视图）
2. 场景中应该出现你的角色模型
3. 如果看不见或太大：
   - 选中模型 → 检查器 → 变换
   - 调整 **位置** 到 `(0, 0, 0)`
   - 调整 **缩放** 到合适大小（如 `(0.01, 0.01, 0.01)` 如果模型太大）

---

## 第五步：创建玩家父物体

**重要**：不要把脚本直接挂在 FBX 模型上，而是创建一个父物体来管理。

1. 在 **层级** 窗口中右键 → **创建空对象** → 命名为 `Player`（玩家）
2. 把场景中的 `你的角色` 模型拖到 `Player` 下面，作为子物体
3. 选中子物体（模型），重命名为 `Model`（模型）
4. 调整 `Model` 的 变换：
   - 位置：`(0, 0, 0)`（相对父物体居中）
   - 旋转：`(0, 0, 0)`
   - 缩放：根据模型大小调整，建议先保持 `(1, 1, 1)`，如果模型太大改 `(0.01, 0.01, 0.01)`

### 添加碰撞器（2D）

虽然模型是 3D 的，但物理用 2D 碰撞器：

1. 选中 `Player`（父物体）
2. 检查器 → **添加组件** → 搜索 **胶囊碰撞器 2D**
3. 调整碰撞器大小：
   - **大小**：根据角色调整（如 `X=1, Y=2`）
   - **偏移**：让碰撞器对齐角色脚底
4. 在 **场景** 视图中按 **G** 键（或点击工具栏小手下面的移动按钮），拖动碰撞器手柄，确保它包围角色

### 添加刚体（2D）

1. 选中 `Player`（父物体）
2. 检查器 → **添加组件** → 搜索 **刚体 2D**
3. 设置：
   - **重力缩放**：`0`（俯视角游戏不需要重力）
   - **约束** → **冻结旋转**：勾选 **Z**（防止角色被撞后旋转）

### 添加动画器

1. 选中 `Player`（父物体）
2. 检查器 → **添加组件** → 搜索 **动画器**
3. 暂时空着，第六步创建控制器后再填

---

## 第六步：创建动画控制器

1. 在 项目 窗口中，`Assets/_Project/Animations/AnimatorControllers/` 右键
2. **创建 → 动画控制器** → 命名为 `PlayerAC`（玩家动画控制器）
3. 双击 `PlayerAC`，打开 **动画器** 窗口（如果弹出了新窗口，把它停靠在 场景 视图旁边）

### 创建动画状态

1. 在 动画器 窗口的空白区域 **右键** → **创建状态 → 空**
2. 重命名为 `Idle`（待机）（点击名字改）
3. 再右键 → **创建状态 → 空** → 重命名为 `Walk`（行走）
4. 再右键 → **创建状态 → 空** → 重命名为 `Attack`（攻击）
5. 右键 `Idle` → **设为层默认状态**（Idle 变成黄色，表示默认状态）

### 创建参数

1. 在 动画器 窗口左下角，点击 **参数** 标签
2. 点击 **+** 按钮：
   - 选择 **浮点数** → 命名为 `Speed`（速度）
   - 选择 **触发器** → 命名为 `AttackTrigger`（攻击触发器）

### 创建状态切换（过渡）

**待机 → 行走（当 速度 > 0.1）**：
1. 右键 `Idle` → **创建过渡**
2. 鼠标拖到 `Walk` 上，松开
3. 点击这条白色箭头（过渡）
4. 在 检查器 中：
   - **有退出时间**：取消勾选（☐）
   - **过渡持续时间**：改成 `0.1`（过渡时间 0.1 秒）
   - 点击 **+** 在 **条件** 下添加条件：
     - `Speed` **大于** `0.1`

**行走 → 待机（当 速度 < 0.1）**：
1. 右键 `Walk` → **创建过渡** → 拖到 `Idle`
2. 点击箭头
3. 检查器：
   - **有退出时间**：取消勾选
   - **过渡持续时间**：`0.1`
   - 条件: `Speed` **小于** `0.1`

**任何状态 → 攻击（当触发 攻击触发器）**：
1. 右键空白区域 → **创建过渡** → 拖到 `Attack`
2. 点击箭头
3. 检查器：
   - **有退出时间**：取消勾选
   - **过渡持续时间**：`0.05`
   - 条件: `AttackTrigger`

**攻击 → 待机（播放完自动返回）**：
1. 右键 `Attack` → **创建过渡** → 拖到 `Idle`
2. 点击箭头
3. 检查器：
   - **有退出时间**：勾选（☑）
   - **退出时间**：`0.95`（播放 95% 后退出）
   - **过渡持续时间**：`0.1`
   - 不需要额外条件

### 绑定动画片段

1. 回到 项目 窗口，找到 `你的角色.fbx`
2. 点击旁边的小箭头展开，应该能看到动画片段（如 `Idle`, `Walk`）
3. 把 `Idle` 动画片段拖到 动画器 窗口的 `Idle` 状态上
4. 把 `Walk` 动画片段拖到 `Walk` 状态上
5. 把 `Attack` 动画片段拖到 `Attack` 状态上

### 绑定到玩家

1. 选中 **层级** 中的 `Player`
2. 在 检查器 中，找到 **动画器** 组件
3. 把 项目 窗口中的 `PlayerAC` 拖到 **控制器** 字段上

---

## 第七步：设置相机

1. 在 **层级** 中找到 **主摄像机**（Main Camera）
2. 选中它，检查器 中设置：

   **变换**：
   - 位置：`(0, 15, -10)`
   - 旋转：`(60, 45, 0)`（60度俯视，45度侧偏）

   **摄像机** 组件：
   - **投影**：**正交**（Orthographic）
   - **大小**：`5`（根据角色大小调整，如果角色太小就改大，如 8 或 10）
   - **背景**：点击颜色选择器，选一个合适的颜色（如雪地用浅蓝色 `#87CEEB`）
   - **清除标志**：纯色

3. 点击 场景 视图的 **2D 按钮**（取消 2D 模式，确保是 3D 视图），从上方看角色，调整相机位置让角色在画面中央

---

## 第八步：创建地面（参考平面）

### 方法一：用 3D 平面（推荐，最简单）

1. 层级 右键 → **3D 对象 → 平面** → 命名为 `Ground`（地面）
2. 创建材质：`Assets/_Project/Materials/` 右键 → **创建 → 材质** → 命名为 `GroundMat`（地面材质）
3. 选中 `GroundMat` → 检查器 → **反照率** 颜色 → 选地面颜色（如草地 `#2d4a1e`）
4. 把 `GroundMat` 拖到 `Ground` 上
5. 调整 `Ground` 的 **变换** → **缩放**：`(10, 1, 10)`（让地面足够大）

### 方法二：用 2D 精灵图（如果你已经有地面图片）

1. 层级 右键 → **2D 对象 → 精灵图** → 命名为 `Ground`
2. 需要先有精灵图资产，如果没有，先用方法一

---

## 第九步：创建输入动作资产

1. 在 `Assets/_Project/Scripts/Input/` 右键 → **创建 → 输入动作**
2. 命名为 `PlayerInputActions`（玩家输入动作）
3. 双击打开（会弹出一个新窗口）

### 配置动作映射（Action Map）

1. 默认已经有了 `Player` 动作映射，保留它
2. 删除默认的 `Fire` 动作（点击 `Fire` → 右键 → **删除动作**）

### 添加 移动 动作

1. 点击 **+**（添加动作）→ 命名为 `Move`（移动）
2. 右侧 **动作类型**：`值`
3. **控制类型**：`二维向量`（Vector2）
4. 在 `Move` 下点击 **+**（添加绑定）→ 选择 **二维向量**
5. 展开 二维向量，点击每个方向绑定按键：
   - 上: `W`（键盘）
   - 下: `S`（键盘）
   - 左: `A`（键盘）
   - 右: `D`（键盘）
6. 再点击 **+**（添加绑定）→ 选择 **二维向量** → 绑定方向键（上下左右箭头键）

### 添加 攻击 动作

1. 点击 **+** → 命名为 `Attack`（攻击）
2. 动作类型: `按钮`（Button）
3. 点击 **+**（添加绑定）→ 在 **路径** 中选择：`鼠标 / 左键`（Mouse / Left Button）

### 添加其他动作（可选）

- `Sprint`（冲刺）: 按钮 → `Shift`（键盘）
- `Dodge`（闪避）: 按钮 → `空格`（键盘）

### 保存并生成 C# 代码

1. 点击左上角 **软盘图标**（保存资产）或按 **Ctrl + S**
2. 在 检查器 中（选中 `PlayerInputActions`）：
   - 勾选 **生成 C# 类**
   - 点击 **应用**
3. Unity 会自动生成 `PlayerInputActions.cs`（在同级目录）

---

## 第十步：创建玩家控制脚本

1. 在 `Assets/_Project/Scripts/Entities/` 右键 → **创建 → C# 脚本**
2. 命名为 `PlayerController`（玩家控制器）
3. 双击打开（会用 Visual Studio 或 VS Code 打开）
4. 粘贴以下代码（完全替换默认代码）：

```csharp
using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(Rigidbody2D))]
[RequireComponent(typeof(Animator))]
public class PlayerController : MonoBehaviour
{
    [Header("移动")]
    public float moveSpeed = 5f;
    public float rotationSpeed = 15f;
    
    [Header("引用")]
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
        
        // 旋转：面朝鼠标方向
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

## 第十一步：挂载脚本并运行

### 挂载脚本

1. 在 **层级** 中选中 `Player`
2. 把 `PlayerController` 脚本从 项目 窗口拖到 检查器 底部（或点击 添加组件 → 搜索 PlayerController）
3. 在 检查器 中检查 PlayerController 的字段：
   - **模型变换**：应该自动识别到 `Model` 子物体，如果没有，手动把 `Model` 从 层级 拖到这个字段

### 设置图层（Layer）

1. 顶部菜单 → **编辑 → 项目设置 → 标签和图层**（Tags and Layers）
2. 在 **图层** 中找到 **用户图层 8**（或任意空位）
3. 命名为 `Ground`（地面）
4. 选中 `Ground` 物体 → 检查器 → **图层** 下拉框 → 选择 `Ground`

### 运行测试

1. 点击顶部中间的 **▶ 播放** 按钮
2. 预期效果：
   - 角色在场景中央显示，播放 待机 动画
   - 按 WASD 移动，角色面朝鼠标方向
   - 动画在 待机 和 行走 之间切换
   - 按鼠标左键，播放 攻击 动画
   - 相机会跟随玩家

3. 如果没有跟随，在摄像机上添加脚本（后续步骤）

---

## 第十二步：添加相机跟随脚本（可选，如果相机不动）

1. `Assets/_Project/Scripts/World/` 右键 → **创建 → C# 脚本** → 命名为 `CameraFollow`（相机跟随）
2. 粘贴代码：

```csharp
using UnityEngine;

public class CameraFollow : MonoBehaviour
{
    public Transform target; // 目标
    public float smoothSpeed = 0.125f; // 平滑速度
    public Vector3 offset = new Vector3(0, 15, -10); // 偏移
    
    void LateUpdate()
    {
        if (target == null) return;
        
        Vector3 desiredPosition = target.position + offset; // 目标位置
        Vector3 smoothedPosition = Vector3.Lerp(transform.position, desiredPosition, smoothSpeed); // 平滑插值
        transform.position = smoothedPosition; // 应用位置
        
        transform.LookAt(target); // 看向目标
    }
}
```

3. 保存
4. 把 `CameraFollow` 拖到 **主摄像机** 上
5. 把 `Player` 从 层级 拖到 CameraFollow 的 **目标** 字段

---

## 完成检查清单

完成后，请截图或告诉我：

- [ ] 项目已创建，是 2D（内置渲染管线）
- [ ] 新输入系统 已安装并启用
- [ ] 文件夹结构已创建
- [ ] Meshy FBX 已导入，模型在场景中可见
- [ ] 玩家 父物体 + 模型 子物体结构正确
- [ ] 胶囊碰撞器 2D 和 刚体 2D 已添加
- [ ] 动画控制器 已创建并绑定
- [ ] 相机设置为 正交，旋转 (60, 45, 0)
- [ ] 输入动作 已创建并保存
- [ ] 玩家控制器 脚本已挂载
- [ ] 点击 播放 后角色能移动和攻击

**每完成一步，请告诉我进展或截图。遇到任何问题随时提问。**
