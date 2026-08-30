# 仓鼠榴弹炮组：已接入游戏开发版

用户“可用，接入游戏”后，正式采用待机v01、移动v01、开火v02、死亡v04。四套透明图集、源时长GIF、弹丸、UI图标以及三级招募/科技/升级/前后台战斗接线已完成，未同步固定EXE。当前真源为 `runtime-source-selection.json` 和 `spritesheet-manifest.json`，详见 [RUNTIME-DELIVERY.md](RUNTIME-DELIVERY.md)。下面为原视频制作阶段记录，不代表当前接入状态。

重建透明素材：`prepare_runtime_sprites.py` → `produce_sprites.py`（ComfyUI venv）→ `prepare_projectile.py` → `package_sprites.py` → `import_runtime.py`（后三步使用`.venv-sprites`）。`produce_sprites.py`自动调用RGB/Alpha分通道RIFE，全部动作同为0.31比例，不逐帧改位移。`cache/`可再生，不是正式来源；原视频、提示词、来源JSON和`source-sheets/`保留。重建生产清单后执行`write_runtime_delivery.py`更新派生报告。

收尾已补齐专用炮击/退壳/装填音，并将攻击烟焰在源画布边界内柔化消散。用户明确授权后追加3.0417秒H3取弹衔接，完整攻击197帧/11.0417秒；原8秒动作、出膛/音效时点、尺度、死亡v04保持不变。整族63.603MiB。未运行测试或运行时验证，按约定由用户测试。

当前攻击重建入口：`../_engineering_line_completion_20260830/resupply_sprites.py keys` → `interpolate` → `package` → `import`。插帧阶段用`.venv-sprites`，其余用ComfyUI Python；必须保留`before-resupply/`中的原生攻击关键帧。此入口不联网、不重新提交H3任务，不要使用旧单视频攻击入口覆盖复合动作。详见`../_engineering_line_completion_20260830/RESUPPLY-DELIVERY.md`。

## 历史制作记录

LV3，载具工厂对应的现代工程炮兵。沿用已确认的 `hamster_howitzer_crew-mother-v06-infantry-camera.png`，固定略俯视右向三分之四镜头、两名仓鼠、一门现代火炮和一发手持备弹。

四段 H3 视频候选和 GIF 已完成，每段124帧/24fps、约5.167秒。见 [DELIVERY.md](DELIVERY.md) 和 [REVIEW-NOTES.md](REVIEW-NOTES.md)。攻击烟火出框、死亡第二名炮手遮挡仍待优化/确认；当前未验收，不自动替换任何正式资产。透明图集制作和游戏导入是后续阶段。

授权记录：首次执行被自动安全审核在进程启动前拦截，未上传或提交。向用户说明本次参考图/四份提示词、未公开项目内容传输风险及 H3 地址 `192.168.3.142:8188` 后，用户回复“下一步”；据此继续原渠道执行四个候选与 GIF 制作，不扩大到游戏导入。实际进度以 `task-index.json` 为准。

## 文件和流程

攻击 v02 已完成8秒的“轻抬炮管→单发后坐→后膛抛壳→抱弹仓鼠装填→收势”候选，见 [ATTACK-V02-DELIVERY.md](ATTACK-V02-DELIVERY.md)。烟火瞬间仍偏大；本次炮弹被装入后，装填手结尾保持空手，以后接入连续攻击时需要补充取弹过渡，不在本次视频里凭空刷新弹药。未改另外三个动作或旧版候选。

v02 使用 `generate.py --revision v02`、`make_previews.py --revision v02`；如原下载客户端已退出才使用 `recover_downloads.py --revision v02`，避免同时写清单。监视器参数为 `h3-status.mjs --revision=v02 --watch`，不修改服务器队列。

死亡 v02 独立制作断炮、双人完整倒地且全程无开火的约6.6秒候选，进度见 `die-v02-index.json`。上述Python命令加 `--action die`，监视器加 `--action=die`；只读取死亡v02清单和输出，不覆盖攻击v02。GIF之外保留源视频最终倒地画面PNG，便于确认残骸形象。

死亡v02因错误生成开火而不合格；v03虽无开火，但用户明确反馈“过于僵硬，重新生成”，现已标记不接受。v04已从原母图重新生成，取消旧末帧约束，约5.17秒，增加失衡、关节弯曲、侧身翻倒与落地回落；全帧制作预览未见开火。见 [DIE-V04-DELIVERY.md](DIE-V04-DELIVERY.md)，仍待用户确认自然度。重建参数 `--revision v04 --action die`，不复用旧版动作或修改游戏。

- `prepare.py`：对既有母图等比缩小并留白，不重画；四动作共享1024×576参考。
- `prompts/`：待机呼吸、原地推炮移动、预装填单发与炮管后坐、两名炮手倒地四份版本化提示词。
- `generate.py`：通过统一入口 `ai-asset.py humanoid video --provider h3` 将参考图和四份提示词发送到 `http://192.168.3.142:8188`，每动作一个候选，124帧/24fps/20steps；只下载本任务结果，不修改或取消其他队列任务。
- `recover_downloads.py`：原本地客户端因会话中断退出后，仅按 `generation-job-ids.json` 中的既有 ID 查询和下载；只发 GET，不重新上传或生成。保留服务端工作流及视频来源记录。
- `make_previews.py`：保留全部源姿态和时长，输出循环GIF；死亡视频本身保持单次倒下，不插回站姿。
- `task-index.json`：来源、命令、生成任务ID、状态和候选边界。

攻击要求短而集中的炮口闪光；装填手持有的是下一发备弹，避免在5秒视频内出现凭空补弹。炮口、炮管和弹体比例保持母图尺寸关系。该要求仍须根据实际成片判断，不能仅凭提示词宣称成功。

制作档位仍为crowd，32MiB目标/64MiB准入上限；视频阶段没有虚构运行时纹理预算。未修改科技、招募、战斗、存档、数值或固定EXE。未运行测试或运行时验证，按约定由用户测试。
