using UnityEngine;

[RequireComponent(typeof(Rigidbody2D))]
public class PlayerController : MonoBehaviour
{
    [Header("移动")]
    public float moveSpeed = 5f;
    public float sprintSpeed = 10f;
    public float rotationSpeed = 15f;
    
    [Header("引用")]
    public Transform modelTransform;
    
    private Vector2 moveInput;
    private Rigidbody2D rb;
    private Animator animator;
    
    void Awake()
    {
        rb = GetComponent<Rigidbody2D>();
        
        if (modelTransform == null)
            modelTransform = transform.Find("Model");
        
        if (modelTransform != null)
            animator = modelTransform.GetComponent<Animator>();
    }
    
    void Update()
    {
        // 读取输入（旧版API，最稳定）
        float h = Input.GetAxisRaw("Horizontal");
        float v = Input.GetAxisRaw("Vertical");
        
        // 死区过滤：防止误触发
        if (Mathf.Abs(h) < 0.1f) h = 0f;
        if (Mathf.Abs(v) < 0.1f) v = 0f;
        
        moveInput = new Vector2(h, v);
        if (moveInput.magnitude > 1f)
            moveInput.Normalize();
        
        // 冲刺
        bool isRunning = Input.GetKey(KeyCode.LeftShift) && moveInput.magnitude > 0.1f;
        if (animator != null)
            animator.SetBool("IsRunning", isRunning);
        
        // 攻击：鼠标左键
        if (Input.GetMouseButtonDown(0))
        {
            OnAttack();
        }
    }
    
    void FixedUpdate()
    {
        // 移动
        float speed = Input.GetKey(KeyCode.LeftShift) ? sprintSpeed : moveSpeed;
        rb.velocity = moveInput * speed;
        
        // 旋转：面朝鼠标方向
        Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);
        Plane plane = new Plane(Vector3.up, transform.position);
        if (plane.Raycast(ray, out float enter))
        {
            Vector3 hitPoint = ray.GetPoint(enter);
            Vector3 lookDir = hitPoint - transform.position;
            lookDir.y = 0f;
            
            if (lookDir.magnitude > 0.1f)
            {
                Quaternion targetRot = Quaternion.LookRotation(lookDir);
                modelTransform.rotation = Quaternion.Slerp(
                    modelTransform.rotation, targetRot, 
                    rotationSpeed * Time.fixedDeltaTime);
            }
        }
        
        // 动画参数
        if (animator != null)
            animator.SetFloat("Speed", moveInput.magnitude);
    }
    
    void OnAttack()
    {
        // 播放攻击动画
        if (animator != null)
            animator.SetTrigger("AttackTrigger");
        
        // 延迟0.3秒后执行伤害判定（等动画播放到攻击帧）
        Invoke(nameof(PerformAttack), 0.3f);
    }
    
    void PerformAttack()
    {
        // 在角色前方检测敌人
        // 检测中心点：角色位置 + 前方1.5米
        Vector3 attackCenter = transform.position + modelTransform.forward * 1.5f;
        float attackRadius = 2f;
        
        // 使用圆形检测，只检测 Enemy 图层
        Collider2D[] hits = Physics2D.OverlapCircleAll(
            attackCenter, 
            attackRadius, 
            LayerMask.GetMask("Enemy")
        );
        
        // 对检测到的每个敌人造成伤害
        foreach (Collider2D hit in hits)
        {
            EnemyController enemy = hit.GetComponent<EnemyController>();
            if (enemy != null)
            {
                enemy.TakeDamage(20f); // 造成20点伤害
            }
        }
    }
}
