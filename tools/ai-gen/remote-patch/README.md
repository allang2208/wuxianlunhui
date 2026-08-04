# 远程 5080：flux2fun-controlnet 兼容修复任务书（2026-08-04）

## 问题

远程 5080（192.168.3.142）ComfyUI 0.30.0 上，`comfyui-flux2fun-controlnet`（v1.1.0）
与 FLUX.2 核心（0.30.0）有两处不兼容（本机 2026-08-04 实测）：
1. `flux_patch.py` 的 `patched_forward_orig` 签名停留在 FLUX.1，不接收
   `timestep_zero_index`——FLUX.2 核心会以关键字传入，**任何 FLUX.2 dev/klein 生成
   都报 `patched_forward_orig() got an unexpected keyword argument 'timestep_zero_index'`**
   （plain dev 即崩，与控制网无关）。
2. `nodes.py` 的 `ControlNetWrapper` 缺少 `multigpu_clones` 属性——核心
   `samplers.pre_run_control` 会遍历 `control.multigpu_clones.items()`，
   **带 ControlNet 的工作流报 `'ControlNetWrapper' object has no attribute 'multigpu_clones'`**。

## 修复（在 5080 上执行）

1. 备份原文件：
   ```bat
   copy "D:\开发文件\ComfyUI\custom_nodes\comfyui-flux2fun-controlnet\flux_patch.py" "D:\开发文件\ComfyUI\custom_nodes\comfyui-flux2fun-controlnet\flux_patch.py.bak"
   ```
2. 用本目录两个 **compat-fixed 版**文件**整体替换**同名文件：
   - `flux_patch.py`（16KB）替换 `custom_nodes\comfyui-flux2fun-controlnet\flux_patch.py`
   - `nodes.py`（27KB）替换 `custom_nodes\comfyui-flux2fun-controlnet\nodes.py`
3. 修复内容：
   - `patched_forward_orig` 签名新增 `timestep_zero_index=None`，兼容 FLUX.2 核心调用；
   - 无 Flux2 Fun ControlNet 激活时，直接委托核心原版 `forward_orig`，
     普通 FLUX.2 dev/klein 生成与核心完全一致（不再受影响）；
   - 有 ControlNet 激活时，复刻核心的 `timestep_zero_index`/参考 latent 调制处理
     （vec 拆分 + modulation_dims 参数），多图参考 + 控制网可共存。
   - `ControlNetWrapper` 新增 `self.multigpu_clones = {}`（单卡空表，遍历即跳过）。
4. 重启 ComfyUI（关掉窗口/进程后重新运行启动脚本，确保监听 0.0.0.0:8188）。
5. 验证：启动日志出现 `[Flux2 Fun] ControlNet patch applied`，且无 ImportError。

## 验收（修复后由本机重新跑）

```bat
python tools/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-fp8 --prompt "a magic skill icon, purple hexagonal badge, white background" --size 512x512 --steps 12 --out test.png
python tools/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth --control-image depth.png --prompt "..." --size 512x512 --steps 12 --out test2.png
```

两张图都能正常出图即修复完成。

## 说明

- 上游 `bryanmcguire/comfyui-flux2fun-controlnet` 最新版（v1.1.0，2026-01-10）仍存在这两个
  问题，此修复为本地兼容补丁；远程升级该 custom node 或 ComfyUI 核心后需复核本补丁是否仍需。
- `flux_patch.orig.py` / `nodes.orig.py` 为上游原始文件备份，便于对照/回滚。
