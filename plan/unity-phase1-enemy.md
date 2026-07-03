# Phase 1: 添加敌人系统

## 目标
- 在场景中生成一个敌人
- 敌人能朝向玩家、移动、受伤、死亡
- 玩家攻击能击中敌人

---

## 第一步：创建敌人 Prefab

### 1. 创建敌人父物体

1. 在 **层级** 中右键 → **创建空对象** → 命名为 `Enemy`
2. 把 `Enemy` 拖到 `Assets/_Project/Prefabs/` 保存为 **Prefab**（拖进去时选 Original Prefab）
3. 从层级中删除 `Enemy`（保留 Prefab 即可）

### 2. 给敌人添加模型

**方法A：复用玩家模型（最简单）**
1. 从 **项目** 窗口把角色 FBX 拖到层级
2. 把它拖到 `Enemy` 下面作为子物体，命名为 `Model`
3. 或者更简单：直接把 `PlayerPrefab` 拖到场景，复制一份，重命名为 `Enemy`

**方法B：如果你有其他敌人模型**
1. 把敌人 FBX 拖到 `Assets/_Project/Models/Enemies/`
2. 配置 Rig（通用或人形）
3. 拖到场景作为 `Enemy` 的子物体

### 3. 给敌人添加组件

选中 `Enemy`（父物体）：
- **添加组件** → **胶囊碰撞器 2D**（Capsule Collider 2D）
- **添加组件** → **刚体 2D**（Rigidbody 2D）
  - 重力大小：0
  - 约束 → 冻结旋转 → 勾选 Z
- **添加组件** → **动画器**（Animator）
  - 控制器：可以复用 PlayerAC，或创建新的 EnemyAC（只有 Idle 状态）

---

## 第二步：创建敌人脚本

1. `Assets/_Project/Scripts/Entities/` 右键 → **创建 → C# 脚本** → 命名为 `EnemyController`
2. 双击打开，粘贴以下代码：

```csharp
using UnityEngine;

[RequireComponent(typeof(Rigidbody2D))]
public class EnemyController : MonoBehaviour
{
    [Header("属性")]
    public float maxHP = 100f;
    public float currentHP;
    public float moveSpeed = 2f;
    public float detectionRange = 15f; // 发现玩家距离
    public float attackRange = 2f; // 攻击距离
    
    [Header("引用")]
    public Transform modelTransform;
    private Transform player;
    private Rigidbody2D rb;
    private Animator animator;
    
    void Awake()
    {
        currentHP = maxHP;
        rb = GetComponent<Rigidbody2D>();
        
        if (modelTransform == null)
            modelTransform = transform.Find("Model");
        
        if (modelTransform != null)
            animator = modelTransform.GetComponent<Animator>();
            
        // 找到玩家
        GameObject playerObj = GameObject.FindWithTag("Player");
        if (playerObj != null)
            player = playerObj.transform;
    }
    
    void FixedUpdate()
    {
        if (player == null) return;
        
        float distance = Vector2.Distance(transform.position, player.position);
        
        if (distance < detectionRange)
        {
            // 朝向玩家
            Vector2 dir = (player.position - transform.position).normalized;
            
            if (distance > attackRange)
            {
                // 移动向玩家
                rb.velocity = dir * moveSpeed;
                
                if (animator != null)
                    animator.SetFloat("Speed", 1f);
            }
            else
            {
                // 在攻击范围内，停止移动
                rb.velocity = Vector2.zero;
                
                if (animator != null)
                    animator.SetFloat("Speed", 0f);
            }
            
            // 旋转朝向玩家
            if (dir.magnitude > 0.1f)
            {
                Quaternion targetRot = Quaternion.LookRotation(new Vector3(dir.x, 0, dir.y));
                modelTransform.rotation = Quaternion.Slerp(
                    modelTransform.rotation, targetRot, 10f * Time.fixedDeltaTime);
            }
        }
        else
        {
            // 玩家太远，Idle
            rb.velocity = Vector2.zero;
            if (animator != null)
                animator.SetFloat("Speed", 0f);
        }
    }
    
    public void TakeDamage(float damage)
    {
        currentHP -= damage;
        Debug.Log(gameObject.name + " 受伤: " + damage + ", 剩余HP: " + currentHP);
        
        if (currentHP <= 0)
        {
            Die();
        }
    }
    
    void Die()
    {
        Debug.Log(gameObject.name + " 死亡!");
        // 可以在这里播放死亡动画
        // Destroy(gameObject, 2f); // 2秒后销毁
        gameObject.SetActive(false); // 先隐藏，后续做对象池
    }
}
```

3. 保存

---

## 第三步：给玩家添加攻击判定

修改 `PlayerController` 脚本，添加攻击时的伤害检测：

```csharp
// 在 PlayerController.cs 的 OnAttack 方法中，添加：
void OnAttack()
{
    animator.SetTrigger("AttackTrigger");
    
    // 延迟检测（等攻击动画播放到伤害帧时检测）
    Invoke(nameof(PerformAttack), 0.3f); // 0.3秒后执行伤害判定
}

void PerformAttack()
{
    // 在角色前方检测敌人
    float attackRange = 3f; // 攻击范围
    float attackWidth = 1.5f; // 攻击宽度
    
    // 使用 OverlapCircle 检测前方扇形区域
    Collider2D[] hits = Physics2D.OverlapCircleAll(
        transform.position + modelTransform.forward * (attackRange * 0.5f), 
        attackRange, 
        LayerMask.GetMask("Enemy") // 需要在 Unity 中创建 Enemy Layer
    );
    
    foreach (Collider2D hit in hits)
    {
        EnemyController enemy = hit.GetComponent<EnemyController>();
        if (enemy != null)
        {
            enemy.TakeDamage(20f); // 造成20点伤害
        }
    }
}
```

**保存后，需要在 Unity 中设置 Layer**：
1. 顶部菜单 → **编辑 → 项目设置 → 标签和图层**
2. 在 **图层** 中，找到 **用户图层 6**
3. 命名为 **Enemy**
4. 选中场景中的 **Enemy** → **检查器** → **图层** → 选择 **Enemy**

---

## 第四步：在场景中生成敌人

### 方法A：手动放置（测试用）

1. 从 **项目** 窗口把 `Enemy` Prefab 拖到场景
2. 放在离玩家远一点的位置（如 X=10, Z=10）
3. 点击 **▶ 播放**

### 方法B：创建敌人生成器（EnemySpawner）

1. `Assets/_Project/Scripts/World/` 右键 → **创建 → C# 脚本** → `EnemySpawner`
2. 粘贴：

```csharp
using UnityEngine;

public class EnemySpawner : MonoBehaviour
{
    public GameObject enemyPrefab;
    public float spawnInterval = 5f; // 每5秒生成一个
    public float spawnRadius = 10f; // 在玩家周围10-20米生成
    public float minSpawnDistance = 10f;
    public int maxEnemies = 10; // 最大敌人数量
    
    private Transform player;
    private float timer;
    
    void Start()
    {
        GameObject playerObj = GameObject.FindWithTag("Player");
        if (playerObj != null)
            player = playerObj.transform;
    }
    
    void Update()
    {
        timer += Time.deltaTime;
        if (timer >= spawnInterval)
        {
            timer = 0f;
            SpawnEnemy();
        }
    }
    
    void SpawnEnemy()
    {
        if (player == null || enemyPrefab == null) return;
        
        // 获取当前敌人数量
        int currentEnemies = GameObject.FindGameObjectsWithTag("Enemy").Length;
        if (currentEnemies >= maxEnemies) return;
        
        // 随机方向
        float angle = Random.Range(0f, 360f) * Mathf.Deg2Rad;
        float distance = Random.Range(minSpawnDistance, spawnRadius);
        Vector3 spawnPos = player.position + new Vector3(
            Mathf.Cos(angle) * distance, 
            0, 
            Mathf.Sin(angle) * distance
        );
        
        Instantiate(enemyPrefab, spawnPos, Quaternion.identity);
    }
}
```

3. 保存
4. 在场景中创建一个空物体，命名为 `EnemySpawner`
5. 把 `EnemySpawner` 脚本拖上去
6. 把 `Enemy` Prefab 拖到 `EnemySpawner` 的 **Enemy Prefab** 字段

---

## 第五步：运行测试

1. 点击 **▶ 播放**
2. 预期效果：
   - 敌人出现在玩家附近
   - 敌人朝向玩家移动
   - 进入攻击范围后停止
   - 玩家按鼠标左键攻击，敌人受伤（看控制台 Debug.Log）
   - 敌人 HP 归零后死亡（隐藏）

---

## 完成检查清单

- [ ] Enemy Prefab 已创建
- [ ] Enemy 有碰撞器、刚体、动画器
- [ ] EnemyController 脚本已挂载
- [ ] PlayerController 添加了 PerformAttack 方法
- [ ] 创建了 Enemy Layer，敌人设置为该图层
- [ ] 场景中放置了敌人或 EnemySpawner
- [ ] 运行后敌人能移动、受伤、死亡

**请按顺序操作，完成后告诉我结果。**
