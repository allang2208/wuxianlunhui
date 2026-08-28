# 僵尸地牢限定随机事件扩充（2026-08-27）

## 运行时映射

| 等级 | 事件键 | 标题 | 背景文件 | 区分机制 |
|---|---|---|---|---|
| F | `quarantineBell` | 隔离警钟 | `quarantine-bell.png` | 读取警报码揭图 / 攀爬拆取物资 |
| E | `corpseWaxWorkshop` | 尸蜡工坊 | `corpse-wax-workshop.png` | 精炼尸蜡制药 / 忍耐毒烟获得防护 |
| D | `sealedSurvivorCell` | 封死的幸存者牢房 | `sealed-survivor-cell.png` | 分辨求救真伪 / 强行破封并承担尸群风险 |
| D | `ossuaryOrgan` | 骸骨管风琴 | `ossuary-organ.png` | 动作节奏演奏 / 机关校音与暗门探索 |
| C | `plagueSpecimenVault` | 瘟疫标本库 | `plague-specimen-vault.png` | 配制净化血清 / 搬运高价值污染样本 |

五个事件全部登记为 `scope:'zombie'`，继续走“当前地牢等级±1”的限定池筛选。僵尸初级F可抽F/E，僵尸中级E可抽F/E/D，僵尸高级D可抽E/D/C；通用事件30%、限定事件70%的两段抽取不变。

## 背景生成提示词集

生成方式：Codex 内置 ImageGen，逐事件独立生成。公共规格：`stylized-concept`；Phaser全屏地牢随机事件背景；3:2横图；暗色写实中世纪瘟疫地牢，真实潮湿黑石、锈铁、旧木、骨骼和低饱和冷色光；中景单一叙事主体；底部约25%保持低细节暗地面供事件面板覆盖；禁止文字、可读字母、Logo、水印、UI、分栏、边框和现代科技设备。

1. `quarantine-bell`：坍塌石岗楼内的黑斑铁钟，钟绳穿过腕骨，墙面仅保留不可读刻痕，断梁上有密封钱匣。
2. `corpse-wax-workshop`：狭窄石室内一列古旧铜锅，乳白尸蜡无火翻涌，蜡封药瓶微光，凝固脂块堵住砖砌抽风炉。
3. `sealed-survivor-cell`：由家具和铁链从外侧封死的牢门，门缝推出染血地图与空药瓶，门后深处仅见含混人影和抓痕。
4. `ossuary-organ`：嵌在墓室墙中的骸骨管风琴，以脊骨作键、肋骨作风箱，银音栓、残缺无字乐谱和两侧抬头尸骸。
5. `plague-specimen-vault`：中世纪炼金瘟疫标本库，裂纹玻璃培养罐装浑浊绿液与缝合畸变尸体，中央血清离心器、封蜡样本箱和机械压力表。
