# 战壕突击兵正式归档（2026-09-02）

本目录保存战壕突击兵从已批准母图到正式运行时资产的最小可重建链。角色固定为金橙毛苏式仓鼠步兵，红星钢盔、绗缝棉服、钢胸甲与木托A10/Model 10-A风格泵动堑壕霰弹枪；移动视频中用户已允许保留的长尾不再重抽。

运行时正式资源位于：

- `assets/companions/trench_assault/{idle,running,attacking,dying}.png`
- `assets/sounds/friendly/trench_assault_attack_video.wav`
- `assets/ui/unit-icons/hamster-trench-assault.png`
- `data/hamster-trench-assault-config.json`及`public/data`镜像

归档保留三代母图与提示词、实际母图参考、动作提示词、关键帧、方向参考、4段正式源视频及生成JSON、未插帧源表、最终GIF、RIFE/源表报告、方向判定、制作脚本和清理清单。已拒视频二进制、重复预览、逐帧抠图缓存和`__pycache__`不进入Git；失败提示词、供应商元数据与拒绝原因仍可追溯。

正式动作规格：待机26帧/12fps循环，移动36帧/24fps循环，攻击33帧/22fps单次1500ms，死亡49帧/24fps单次。四套格子均为336×160，逐动作脚线由配置`footY`消费。攻击释放点是0-based输出索引10，对应运行时1-based `attackLaunchFrame:11`。

本次只做静态配置/调用链核对，没有启动游戏、构建、测试、浏览器探针或EXE发布。`manifest.json`列出本目录文件哈希和运行时资源哈希。
