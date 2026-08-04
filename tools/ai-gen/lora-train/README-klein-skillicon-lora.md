# 训练任务书：FLUX.2 Klein 4B 技能图标风格 LoRA（v1）

## 目标

用游戏已入库的"六边形徽章魔法技能图标"系列（7 张，1024² 白底）训练一个
**Klein 4B 风格 LoRA**，触发词 `wuxianlunhui magic skill icon`。
用途：新技能图标生成时保持徽章模板/金色描边/浮雕水晶底座风格一致。

**基座选型**：Klein 4B（Apache 2.0 可商用）——项目已确定商用方向，Dev/9B 非商用许可不用于生产。

## 数据集

- 已就绪：7 图 + 7 标注（AI-Toolkit/kohya 兼容平铺格式）
- 本机路径：`Y:\工作\无尽轮回\scratch\klein-lora-skillicon\dataset`
- UNC：`\\192.168.3.2\工作杂项\工作\无尽轮回\scratch\klein-lora-skillicon\dataset`
- 复制到 5080 本地磁盘（训练不经过 SMB）：
  ```bat
  robocopy "\\192.168.3.2\工作杂项\工作\无尽轮回\scratch\klein-lora-skillicon\dataset" "D:\开发文件\lora-train\dataset" /E /J /MT:16
  ```
- 标注结构：`wuxianlunhui magic skill icon, game skill icon emblem, purple hexagonal
  badge with gold trim and embossed translucent crystal block base at the bottom,
  the center shows <主题>, centered, game asset art, high detail, crisp, isolated
  on a plain pure white background`

## 基座文件（5080 已有，指向 ComfyUI models 目录）

- diffusion_models：`D:\开发文件\ComfyUI\models\diffusion_models\flux-2-klein-4b-fp8.safetensors`
- text_encoders：`D:\开发文件\ComfyUI\models\text_encoders\qwen_3_4b.safetensors`
- vae：`D:\开发文件\ComfyUI\models\vae\flux2-vae.safetensors`

## 工具与步骤

1. 安装 [AI-Toolkit（ostris）](https://github.com/ostris/ai-toolkit)（支持 FLUX.2 klein 模板）；
   或 Kohya sd-scripts（同样支持 FLUX.2）。二选一，以 AI-Toolkit 优先。
2. 用 AI-Toolkit 自带 **FLUX.2 klein 模板**新建 job（extension），只改以下参数：
   - `trigger_word: wuxianlunhui magic skill icon`
   - `dataset path: D:\开发文件\lora-train\dataset`
   - `resolution: [1024, 1024]`（若 OOM 改 [768, 768]）
   - `network dim: 32 / alpha: 16`（7 张小数据集，低秩起步）
   - `lr: 1e-4`（cosine），`batch_size: 1`
   - 步数：约 **100~150 steps**（7 图 × 15~20 epochs）
   - `train_unet: true`，`train_text_encoder: false`（qwen 编码器不动，省显存）
   - 显存优化：fp8/NF4 量化 + block swap（16GB 足够，8.4GB 即可跑 Klein 4B）
   - 输出名：`klein-skillicon-v1`
3. **训练期间建议关闭 ComfyUI**（同一张 5080，避免显存争抢）。
4. 训练完成后把产物复制到 NAS：
   ```bat
   copy "D:\开发文件\lora-train\output\klein-skillicon-v1\klein-skillicon-v1.safetensors" "\\192.168.3.2\工作杂项\工作\无尽轮回\scratch\klein-lora-skillicon\"
   ```

## 验收（本机做）

1. 本机从 NAS 取 LoRA → 复制到两端 `models\loras\`：
   - 5080：`D:\开发文件\ComfyUI\models\loras\`
   - 本机 Daedalus 目录（mesh 后端，小 LoRA 可只走客户端转发，无需两端）
2. 用 `tools/comfyui-gen.py --model flux2-klein-4b --lora klein-skillicon-v1.safetensors`
   生成 4 张新主题图标（触发词开头 + 主题块），走 GLM-4V + `check-icon-sizes.py` 验收。

## 备注

- 7 张为 v1 最小可用集；后续每入库新图标可追加进 dataset 重训（增量迭代）。
- 若 5080 训练环境装不上 AI-Toolkit，回退方案：本机 3080 Ti（12GB）也满足 Klein 4B
  训练显存（~8.4GB），可把基座文件从 5080 经 NAS 拷到本机后本机训。
