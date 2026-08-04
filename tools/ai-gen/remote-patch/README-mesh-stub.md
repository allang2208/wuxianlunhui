# 远程 5080：comfyui-mesh Icarus stub 兼容修复任务书（2026-08-04）

## 问题

5080（192.168.3.142）ComfyUI 0.30.0 跑 mesh 工作流时，任何 FLUX.2 Dev 生成都在模型装载阶段崩溃：

```
AttributeError: 'MeshRemoteStub' object has no attribute 'img_attn' / 'txt_attn'
```

根因：FLUX.2 Dev 33GB 在 5080 16GB 上必然走 ComfyUI 0.30 的低显存（动态 VRAM）
加载路径，该路径会遍历模型中每个 state_dict 键并调用 `set_attr_param`。
Icarus 把远程块替换成的 `MeshRemoteStub` 是空模块，没有 `img_attn`/`txt_attn`
等真实子模块路径，遍历即崩。本机 Daedalus 端无需改（已通过纯字节读取绕过
另一处 safetensors 兼容问题，见 tools/comfyui-mesh-setup.md）。

## 修复（在 5080 上执行）

1. 备份原文件：
   ```bat
   copy "D:\开发文件\ComfyUI\custom_nodes\comfyui-mesh\mesh_node.py" "D:\开发文件\ComfyUI\custom_nodes\comfyui-mesh\mesh_node.py.bak"
   ```
2. 用本目录的 `mesh_node.py`（compat-fixed 版）整体替换同名文件。
   若远程文件与上游不一致，也可手工给 `MeshRemoteStub.__init__` 追加：
   ```python
   # ComfyUI 0.30 lowvram loader walks attribute paths for every
   # state-dict key; materialize dummy submodules so the stub is
   # traversable like a real block (zero params, zero VRAM).
   for leaf in self._mesh_param_sig:
       parts = leaf.split(".")
       mod = self
       for p in parts[:-1]:
           if not hasattr(mod, p):
               mod.add_module(p, nn.Module())
           mod = getattr(mod, p)
   ```
3. 重启 ComfyUI（关窗口后重新运行启动脚本，确认监听 0.0.0.0:8188）。
4. 验证节点仍注册：`http://192.168.3.142:8188/object_info/MeshSplitFlux` 有返回。

## 验收（由本机重跑）

本机 Daedalus 已在 0.0.0.0:7777 READY（n_blocks=4 + Turbo LoRA）。修好后
本机会重新 POST mesh 工作流（20 步基础版），Daedalus 日志应出现
`[server] forward 4 blocks ...` 且 5080 输出第一张图。

## 顺序建议

先应用 flux2fun-controlnet 修复（flux_patch.py / nodes.py），再应用本修复，
然后重启一次即可。两者缺一不可：stub 修复解锁装载阶段，controlnet 修复
解锁 forward 阶段。

## 说明

- 上游 comfyui-mesh 若出新版修复此问题，替换 mesh_node.py 后需复核本补丁
  是否仍需保留（wire-contract 文件 codec.py/protocol.py 等两端必须保持一致）。
- 本补丁只改 stub 的可遍历性，不改变任何 wire 协议或节点行为。
