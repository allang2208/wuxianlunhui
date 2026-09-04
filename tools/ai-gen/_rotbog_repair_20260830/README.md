# 独角仙王素材修复入口（已安装，待游戏内验收）

用户已通过“继续”同意BiRefNet/RIFE本地批处理；本轮已完成生产和正式接入。使用本项目ComfyUI虚拟环境Python，不生成新视频、不外发源素材、不改变原249帧的抽帧来源与动作。

1. `rebuild.py keys --actions charge`：先制作16个冲锋关键帧候选，查看`key-previews/charge.gif`与联系图，重点确认角、触须、腿和灰紫残边。
2. `rebuild.py keys`：为8动作重建全部关键帧。语义遮罩限域、原坐标变换、预乘Alpha缩放，去掉错误支持域；开鞘两动作关闭紫边清除以保留真实粉色翅膜。
3. 查看关键帧候选后执行`rebuild.py finish`：通过本任务专用`rife-colour-bridge.py`调用既有RIFE v4.6，保留原关键帧和Y运动。RGB蓝底插值后以独立RIFE Alpha作支持域，反解同一运动轮廓，避免透明区延展条纹和平涂腿部。公共RIFE脚本未修改。输出全部GIF/联系图和`manifest.json`；小独角仙仅按四动作共用裁框去除透明浪费，不修画、不重新插帧。
4. 查看成品后执行`rebuild.py install`：主怪8动作和小独角仙4动作齐全且预算不超过256MiB才安装；仅替换这12张贴图和两份配置中的对应布局及首帧视觉脚点。该步骤不会构建或同步EXE。
5. `make-delivery.py`：生成同尺寸、同脚点的冲锋/移动前后对比GIF和`preview-index.md`。`refine_interpolation.py`只用于本次颜色合成候选的来源记录，不是正式生产入口。

原视频/关键帧/缩放与根位置来自`../_rotbog_rhinoceros_beetle_king_20260828/`。首次生产会记录`source-config.json`和`original/`；禁止把已经裁过的成品冒充原始关键帧再次插值。目标是减少画布浪费，未承诺能从软化源视频恢复不存在的细节。

正式版本基础RGBA合计119.94MiB（原645.50MiB），共12图、363帧；未缩小主体。详细输出见[八动作预览索引](preview-index.md)和[交付报告](../../../docs/rotbog-beetle-full-repair-2026-08-30.md)。源视频自带的快速动作软化仍保留；未运行测试或运行时验证，按约定由用户测试。
