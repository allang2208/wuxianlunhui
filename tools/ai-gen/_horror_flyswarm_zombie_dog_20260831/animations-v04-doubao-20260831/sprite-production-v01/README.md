# 僵尸犬 v3 精灵图制作

当前正式结果是 `final-crowd/`，对应 `keys/`、`composition.json`、`reports/*-crowd-rife.json` 和 `previews/runtime-speed/`。已复制到 `assets/enemies/zombie_dog/v3/` 并更新双份 zombieDog 配置。详情与直接可看的GIF见[接入记录](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/docs/zombie-dog-v3-animation-integration-2026-08-31.md)。

`final/`、未带 crowd 的初轮RIFE报告和 `previews/rife-source-speed/` 是预算收敛前的制作草案，不是正式成品，不可再导入游戏。第二轮始终从透明原始关键帧重新插帧，没有对第一轮插帧成品再插帧。

制作顺序：`prepare-sprites.py` 保存原运行资源校准及改动前快照；先通过 `ai-asset.py cutout` 处理参考帧，再执行 `build-sprites.py cutouts`、`compose`、`rife`；最后 `integrate-sprites.py` 复制成品、修改僵尸犬节点并制作实际时钟GIF。使用项目相邻ComfyUI虚拟环境与已有BiRefNet/RIFE，不需要新下载模型。

`cutouts/` 是固定1280×720源空间透明关键帧；全动作共享固定缩放/脚点，动作级裁框由anchorX和footY恢复原位置。`before/`仅保存本次修改前的四个接线文件，包含开工前已有并行改动，不可当作仓库HEAD或整体回滚包。

四张纹理共31.648MiB，慢移复用奔跑纹理。GIF按实际配置时钟以50fps取样，避免密集扑咬帧因GIF时长下限被错误放慢。总览包含1.2秒普攻周期示意，不能代替AI、碰撞、遮挡或游戏运行时验收。

未运行测试或运行时验证，按约定由用户测试；未构建、启动游戏或同步EXE。
