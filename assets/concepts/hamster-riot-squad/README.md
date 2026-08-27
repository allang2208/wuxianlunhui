# 仓鼠防暴队（概念候选）

- 状态：仅完成单帧形象候选，尚未经用户确认定稿，未制作动画或接入运行时。
- 参考真源：`../hamster-special-forces/hamster-special-forces-shotgun-concept-v03.png`。
- 生成方式：Codex 内置 ImageGen，以上述仓鼠特战定稿概念作身份、比例、材质和渲染风格参考；源图的棋盘底由项目 BiRefNet-general 管线生成 Alpha 后确定性合成为 RGBA。
- 形象锁：矮宽大头仓鼠比例、沙色数字迷彩、战术防弹衣、黑色包覆式墨镜、露耳战术头盔、左手透明防暴盾、右手短锯泵动霞弹枪。
- 产物：`hamster-riot-squad-concept-v01.png` 为原始 RGB 生成图，`hamster-riot-squad-concept-v01-alpha-mask.png` 为 BiRefNet Alpha 蒙版，`hamster-riot-squad-concept-v01-rgba.png` 为真透明交付候选。
- 禁止：人类细长体型、外骨骼/动力甲、科幻武器、不透明盾牌、字样/徽章/水印。
- 提示词快照：`prompt-v01.txt`。
