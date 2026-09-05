# AI资产历史记录

历史结果与命令，不是现行步骤；当前入口见 [任务工作流](00-workflows.md)。

### 阶段性进度总结（2026-08-04：生图标准工作流 + 提示词固化定稿）

#### 本次完成
1. **生图标准工作流定稿**：`game-dev/tools/ai-gen/WORKFLOW.md`——六步全流程
   （定风格→生成→粗筛→视觉验收→抠图入库→清理废案）+ 生成入口矩阵（智谱 API 优先 /
   ComfyUI 兜底 / 远程 5080 主力 / 本地 3080 Ti 兜底 / models.json 模型登记表）+
   各类资产子流程（技能图标 / 装备图标 / 障碍物 / 怪物 / 投射物 / 视频）+
   沉淀坑位清单 + NAS 归置原则。
2. **提示词固化**：`game-dev/tools/ai-gen/prompts/` 提示词库——
   README（拼接顺序 / 权重语法 / 智谱 vs ComfyUI 差异 / img2img 模板锁定规则）+
   8 个固化模板：skill-icon（六边形徽章系列，含 fireball 内容框基准）、
   equipment-icon（style_prefix + 负面词 + 单件强制 + 构图硬性规则）、obstacle、
   monster-sprite、video（MiniMax H3）、cover（世界-122 掩体六档）、
   defense-tower（世界-122 防御塔）、transparent-subject（透明主体纯色底）。
3. **一致性修正**：文首工作流「标准流程」命名由五步修正为六步（实际条目一直是 6 条）；
   障碍物提示词引用改指 prompts/obstacle.md（旧 obstacle-prompt-strategy.md 收敛为跳转桩）。

#### 验证
- WORKFLOW.md 引用的工具路径全部核实存在（当时位于根 `tools/`，现已整体迁入
  `game-dev/tools/ai-gen/`：comfyui-gen.py、models.json、make-transparent-icon.py、
  check-icon-sizes.py、birefnet-cutout.py、verify-eclipse-icons.py、flip-boots-right.py、
  check-components.py、minimax-h3-gen.py、start-comfyui-remote.bat 等）。
- 模板内容全部来自实战沉淀（陨星/暴风雪图标、稀有三套+首饰、沙袋/拒马、陨星 VFX 视频），非虚构。

---

### 阶段性进度总结（2026-08-04 二轮：生图入口优先级调整 + FLUX.2 dev Depth ControlNet 视角锁定）

#### 本次完成
1. **入口优先级调整**：双机 ComfyUI 优先（远程 5080 主力 + 本机 3080 Ti 兜底）→ 本地零成本；
   智谱 API 降级为第三兜底（双机不可用/特殊场景）。
2. **5080 主力模型实机核对并登记**：FLUX.2 dev fp8（`flux2_dev_fp8mixed` +
   `mistral_3_small_flux2_fp4_mixed` + `flux2-vae`）+ FLUX.2 Depth ControlNet
   （`FLUX.2-dev-Fun-Controlnet-Union`，Depth/Canny/HED/Pose 单文件多模式）已装；
   `tools/ai-gen/models.json` 登记 `flux2-dev-fp8`（24 步/CFG 3.5）+ `flux2-dev-depth`（默认强度 0.75）。
3. **客户端升级**：`tools/ai-gen/comfyui-gen.py` 新增 `--control-image` / `--strength` 与
   ControlNet 工作流分支（Flux2FunControlNetLoader/Apply），深度图锁视角/方向；
   官方 BFL JSON 结构化提示词（camera 块）作双保险。
4. **兼容修复（已应用 2026-08-04）**：flux2fun-controlnet v1.1.0 的
   `timestep_zero_index` / `multigpu_clones` 两处补丁与 comfyui-mesh Icarus stub 补丁
   已在 5080 替换并重启（原文件备份 + 修复版在 `tools/ai-gen/remote-patch/`，NAS 同步一份）；
   Mesh 跨机出图实测通过（`flux2-dev-mesh`，8 步 turbo，Turbo LoRA 两端本地加载）。
5. **文档同步**：WORKFLOW.md（入口矩阵/§1.5/第 2 步）、prompts/ 8 个模板补深度锁用法、
   SKILL.md v2.1、CHANGELOG。

#### 验证
- 远程 5080 在线（192.168.3.142，RTX 5080 16GB，ComfyUI 0.30.0），模型/节点清单实机核对
  （Flux2FunControlNetLoader/Apply 存在，ControlNet 文件在 models/controlnet）。
- `tools/ai-gen/comfyui-gen.py --list-models` 通过；`flux2-dev-mesh` 跨机实测出图成功
  （5080 Icarus + 3080 Ti Daedalus，8 步 turbo，服务端每步 decode~140ms/fwd~9ms/enc~650ms）。

---
