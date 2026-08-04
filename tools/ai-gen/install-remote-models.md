# 5080 机器模型安装任务书（交给那边的 AI 执行）

目标机器：192.168.3.142（RTX 5080 16GB），ComfyUI 目录 `D:\开发文件\ComfyUI`

## 一、安装 FLUX.2 klein 4B（distilled，fp8）

把下面 3 个文件放到对应目录（目录不存在就创建）：

| 文件 | 放到 | 说明 |
|---|---|---|
| `flux-2-klein-4b-fp8.safetensors` | `models\diffusion_models\` | 4B 蒸馏版扩散模型 |
| `qwen_3_4b.safetensors` | `models\text_encoders\` | 文本编码器（与 Z-Image 共用） |
| `flux2-vae.safetensors` | `models\vae\` | VAE |

下载源（HuggingFace 慢就换 ModelScope）：

- `https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/split_files/diffusion_models/flux-2-klein-4b-fp8.safetensors`
- `qwen_3_4b.safetensors` 与 `flux2-vae.safetensors` 在同仓库的 `split_files/text_encoders/` 和 `split_files/vae/` 下

下载完确认文件大小非 0、非 HTML（防止下到 404 页面）。

## 二、（可选）spritesheet LoRA

下载 `fal/flux-2-klein-4b-spritesheet-lora`（Apache 2.0，游戏精灵表专用），
放到 `models\loras\`，文件名记下即可（装好后告诉我，我登记进配置）。

## 三、验证

1. 浏览器打开 `http://127.0.0.1:8188`，在模型列表里能看到上述文件名
2. 或运行 `netstat -ano | findstr 8188` 确认还在监听 `0.0.0.0:8188`
3. 把三个文件的**确切文件名和大小**贴回来（我要同步到 `tools\models.json`）

## 四、注意事项

- 不需要重启 ComfyUI，模型文件放好后下次提交工作流会自动识别
- 不要改动已能用的 `sd_xl_base_1.0.safetensors`（SDXL 保留作对比/兜底）
- 如果下载 Qwen 文本编码器时 HF 太慢，ModelScope 搜索 `qwen_3_4b` 或 `FLUX.2-klein` 镜像
- 安装完直接告诉我"装好了"，我会从本机查询远程 API 核对文件名并跑测试图
