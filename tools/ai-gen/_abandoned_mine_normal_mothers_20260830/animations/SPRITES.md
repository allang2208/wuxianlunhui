# 废弃矿洞普通怪物：精灵图版本说明

当前版本已接入游戏，八张运行时表共422帧；完整数值、布局、GIF与原视频链接见 [INTEGRATION.md](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/INTEGRATION.md)。

首轮全分辨率表曾为幼钻虫640×512、矿石怪896×512，共696帧，统一24fps。用户随后要求统一体量、优化插帧并接入游戏，故当前版本从原关键帧统一减半后重新RIFE，攻击改为1.2/1.6秒，不再沿用旧版5秒播放时间。

首轮成品表、逐帧缓存和重复预览已可恢复清理，不再作为活动资源。保留 [原始提取参数](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/sprite-build/source-manifest.json)、八段原视频、不可变提示词、当前RIFE输入表和制作脚本。正常重建直接使用当前输入，毋需重新调用豆包或BiRefNet。

当前 [source-manifest.json](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/source-manifest.json) 的source字段相对animations目录，指向已保留的半尺寸关键帧；[runtime-manifest.json](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/runtime-manifest.json) 的sheet字段相对仓库根目录。清理清单及恢复目录见 [archive-manifest.json](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/archive-manifest.json)。

未运行游戏测试或运行时验证，按约定由用户测试。
