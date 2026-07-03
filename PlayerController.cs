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
        // 使用旧版输入API（最稳定，兼容所有Unity版本）
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
        
        // 攻击
        if (Input.GetMouseButtonDown(0))
        {
            if (animator != null)
                animator.SetTrigger("AttackTrigger");
        }
        
        // 调试：在控制台查看输入值（确认是否误触发）
        // 如果看到 h 或 v 不为0，说明有按键输入
        if (moveInput.magnitude > 0.01f)
            Debug.Log("输入: h=" + h + " v=" + v);
    }
    
    void FixedUpdate()
    {
        // 移动
        float speed = Input.GetKey(KeyCode.LeftShift) ? sprintSpeed : moveSpeed;
        rb.velocity = moveInput * speed;
        
        // 旋转面朝鼠标
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
}
