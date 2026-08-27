# 黑色眼镜王蛇美术状态（2026-08-25）

## 当前阶段

- 偏真实身份母图 `mother-v01.png` 已获用户确认。
- 用户后续直接进入数值与技能设置，四条状态视频据此视为通过并进入正式制作。
- 四状态透明精灵表、GIF 预览、怪物配置、动画、工厂与战斗技能均已接入运行时。

## 状态视频

| 状态 | 来源 | 文件 | 当前观察 |
|---|---|---|---|
| idle | MiniMax H3 | `video/black-king-cobra-idle-h3.mp4` | 盘圈与竖身稳定，微动与吐信后回到首姿。 |
| walking | 豆包 Seedance 2.0 Mini | `video/black-king-cobra-walking-doubao.mp4` | 水平侧视蛇行，完整身体持续可见。 |
| attacking | 豆包 Seedance 2.0 Mini | `video/black-king-cobra-attacking-doubao.mp4` | 盘圈蓄力、单次前突张口咬击并回位，保留自然源位移。 |
| dying | 豆包 Seedance 2.0 Mini | `video/black-king-cobra-dying-doubao.mp4` | 竖起段逐步失力、落地并保持最终尸体姿态，不回首姿。 |

豆包 MP4 中的浅色地面、接触影和角标已通过项目 BiRefNet 最大主体连通域去除；源视频未直接作为运行时透明素材。

## 精灵表与释放帧

- 正式资源：`assets/enemies/black_king_cobra/`。
- 帧表：idle 12、walking 20、attacking 21、dying 17；明细见 `sheet-manifest.json`。
- attacking 保留自然源位移；实测蛇头最远前探为视频源第77帧，对应0起算精灵第13帧，毒液喷射严格在该帧释放。
- GIF：`previews/final/idle.gif`、`walking.gif`、`attacking.gif`、`dying.gif`。

## 四状态尺度修正

- 初版 walking 来自单独准备的水平蛇身参考，源尺度明显大于其余三套盘圈来源；运行时切换时表现为蛇身突然变粗。
- 以形态学骨架中心线的局部直径中位数衡量，初版 idle/walking 为21.97/49.37px。
- walking 整套统一乘0.448后重建，不做逐帧缩放；新版四状态中位数为 idle 21.97、walking 22.00、attacking 22.00、dying 21.97px。
- walking 正式帧格由1152×512改为640×512；帧数20、帧率12、脚线420和完整蛇行周期不变。
