========================================
  无限轮回 - 修复版使用说明
========================================

【第一步】下载修复文件

下载以下 3 个文件：
  1. index.html      （修复后的游戏入口）
  2. legacy.js       （修复后的核心代码）
  3. start.bat       （一键启动工具）

把这 3 个文件放到你的项目目录下，覆盖原来的文件：

  C:\Users\allan\Desktop\kimi\游戏\测试版本\备份-测试版本\Kimi_Agent_武器动画与尺寸调整\


【第二步】一键启动

进入上面的项目目录，双击运行 start.bat

脚本会自动完成以下操作：
  1. 检查项目目录是否正确
  2. 检查是否安装了 Node.js（没有会提示下载）
  3. 自动安装项目依赖（首次需要几分钟）
  4. 启动 Vite 开发服务器
  5. 自动打开浏览器访问游戏


【手动操作（备用）】

如果 start.bat 无法运行，可以手动操作：

  1. 按 Win + R，输入 cmd，回车
  2. 输入下面命令进入项目目录：

     cd "C:\Users\allan\Desktop\kimi\游戏\测试版本\备份-测试版本\Kimi_Agent_武器动画与尺寸调整"

  3. 安装依赖（第一次需要）：

     npm install

  4. 启动服务器：

     npx vite --open

  5. 浏览器会自动打开，地址是 http://localhost:8765/


【重要提醒】

  1. 不要双击 index.html 直接用浏览器打开！
     必须通过 Vite 服务器访问。

  2. 如果修改了代码需要刷新页面，按 Ctrl + F5 强制刷新。

  3. 如果端口被占用，Vite 会自动换一个端口，
     看命令行输出的实际地址。


【本次修复内容】

  已修复 7 个致命问题：
  - EquipManager.init 重复定义，拖放系统失效
  - DustEffect 工厂参数缺失，粒子系统崩溃
  - 67 个 DOM 元素缺失，多处 getElementById 报错
  - Tab 切换选择器不匹配，面板完全无法切换
  - SmokeEffect 重复定义
  - BloodEffect 重复定义（不同签名）
  - invCapacity vs invCount ID 不匹配

  已修复 22 处代码问题：
  - 12 处 DOM 查询添加 null 安全检查
  - SystemUI 改用 data-page 属性选择 Tab
  - 多处入口函数添加 try-catch 防崩溃
  - 攻击冷却指示器结构修复
  - 状态面板完整重建（45+ 数据绑定元素）
  - 图鉴页面结构重建

  缺失资源文件（不影响启动）：
  - assets/weapons/  18 个武器贴图和帧动画
  - assets/effects/   1 个枪口火焰贴图
  - assets/ammo/      2 个弹药贴图
  - assets/items/     1 个掉落物贴图
  - assets/icons/    11 个装备图标

  代码已包含 onerror 回退处理，缺失图片时显示 emoji 或空白，
  不会导致崩溃。

========================================
