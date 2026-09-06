# 大地图命令徽记源稿与预览

按2026-08-31用户“生成并设计动画、处理大地图操作框架”的请求制作并接入本地开发源码。四个新徽记不替换原鼠标箭头、手型或军团兵旗，游戏内效果待用户验收。

## 来源和输出

- 生成方式：Codex 内置 Image Gen；`manifest.json` 保存每张图的精确提示词、原输出路径、项目内源图与运行时路径。
- 源图：`source-move.png`、`source-attack.png`、`source-enter.png`、`source-blocked.png`，均为1254×1254 RGBA。
- 运行时：`assets/ui/world-map/command-badges/{move,attack,enter,blocked}.png`，均为96×96。按Alpha>16取内容范围，等比缩到最长边88px，居中放入96px透明画布；没有重新着色、补画或修改原生成造型。
- `export-report.json` 记录各图原尺寸、Alpha、裁切、可见尺寸与输出字节。四图合计61,836字节；96×96×4×4约144KiB基础RGBA，不含浏览器自身开销。
- `contact-sheet.png` 为静态对照，`command-feedback-preview.gif` 为960×430、80帧、40ms/帧、3200ms循环的离线动画设计预览。

![动画设计预览](command-feedback-preview.gif)

动画为生成徽记配合外圈的界面效果，未生成角色动作或进城动画。原鼠标48px、热点(3,2)保持固定，附加徽记36px；行军/攻击/入营外圈分别1400/1000/1600ms，禁止悬停静止，下令反馈520ms。参数以 `data/world-map-command-feedback.json` 为源，程序逻辑位于 `src/ui/world-map-command-feedback.js`。

## 重新导出

需要现成 Node.js 与 Sharp，不新增项目依赖：

```powershell
node tools/ai-gen/world-map-command-badges-20260831/export.cjs 'C:/Users/allan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'
```

也可把最后一个参数换为本机已安装 Sharp 的绝对路径。脚本从本目录源图及项目主题/动画配置导出；会覆盖本批四张运行时徽记及本目录预览/导出记录，不改原48px光标或生成源图。GIF使用离线近似缓动，不是游戏捕获，不作为实机验收证据。

完整接线与用户验收项见 `docs/world-map-command-ui-2026-08-31.md`。未运行测试或运行时验证，未构建或同步EXE。
