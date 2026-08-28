# 沼泽地牢限定随机事件（2026-08-27）

## 运行时映射

| 等级 | 事件键 | 标题 | 背景文件 | 主要分支 |
|---|---|---|---|---|
| E | `sunkenHerbalistBasket` | 沉没的药师竹篓 | `sunken-herbalist-basket.png` | 智力辨药 / 幸运捞取 |
| E | `weepingReedBed` | 哭泣的芦苇荡 | `weeping-reed-bed.png` | 精神聆听 / 敏捷追絮 |
| E | `leechBloomPool` | 血蛭花池 | `leech-bloom-pool.png` | 智力采囊 / 敏捷踏石 |
| E | `fireflyGraveIslet` | 萤火墓洲 | `firefly-grave-islet.png` | 精神聆光 / 幸运收萤 |
| D | `willOWispTrail` | 鬼火引路 | `will-o-wisp-trail.png` | 精神辨火 / 幸运追光 |
| D | `rottenRopeBridge` | 腐木索桥 | `rotten-rope-bridge.png` | 敏捷疾渡 / 力量加固 |
| D | `bogHunterRemains` | 沼猎人的遗骸 | `bog-hunter-remains.png` | 智力验尸 / 幸运取符 |
| D | `sunkenDruidShrine` | 沉没的林神祭坛 | `sunken-druid-shrine.png` | 精神祈祷 / 体质净根 |
| D | `frogBoneOracle` | 蛙骨占卜阵 | `frog-bone-oracle.png` | 智力解骨 / 幸运掷骨 |
| D | `mudboundCaravan` | 泥封商队 | `mudbound-caravan.png` | 力量拖箱 / 智力查货 |
| C | `marshGasVents` | 沼气喷口 | `marsh-gas-vents.png` | 智力引燃 / 敏捷集露 |
| C | `rootPrison` | 活根囚笼 | `root-prison.png` | 力量破根 / 精神安抚 |
| C | `blackwaterFerry` | 黑水渡船 | `blackwater-ferry.png` | 精神问渡 / 幸运翻舱 |
| C | `sunkenWitchCauldron` | 沉沼女巫坩埚 | `sunken-witch-cauldron.png` | 智力炼成 / 体质试药 |
| C | `ancientCrocodileTotem` | 远古鳄神图腾 | `ancient-crocodile-totem.png` | 力量取宝 / 精神通灵 |

事件全部登记为 `scope:'swamp'`。沼泽初级（E）可抽 E/D，中级（D）可抽 E/D/C，高级（C）可抽 D/C；两段抽取继续保持通用事件30%、限定事件70%。

## 背景生成提示词集

生成方式：Codex 内置 ImageGen，逐事件独立生成。所有图片采用同一公共规格：`stylized-concept`；Phaser 全屏地牢随机事件背景；3:2 横图、1920×1280意图；暗色写实奇幻、真实湿木/泥水/石材/植被；中景单一叙事主体；底部25%低细节供事件面板覆盖；禁止文字、字母、符号、Logo、水印、UI、分栏、边框和现代物件。

各图主体提示：

1. `sunken-herbalist-basket`：半沉黑水的藤编药篓，掀开的盖下露出琥珀发光药瓶，碎药叶与水下涟漪。
2. `weeping-reed-bed`：无风弯折的灰白高芦苇，种穗以自然排列形成哀伤轮廓，水面草结路标与逆雾芦花。
3. `leech-bloom-pool`：暗红水花、花心透明盘曲血蛭、池底炼药血囊与跨池残破石墩。
4. `will-o-wisp-trail`：青绿鬼火穿过死树林和浓雾形成弯曲路径，一部分照亮旧路标，一部分悬在深黑水面。
5. `rotten-rope-bridge`：腐木板与草绳索桥横跨冒泡泥潭，对岸补给袋，桥头备用木料与金属扣件。
6. `bog-hunter-remains`：鳄皮斗篷猎人遗骸倚空心树，旧弩指雾，根缠腰包、洁净骨符与环形狼爪印。
7. `sunken-druid-shrine`：鹿角林神石像半沉水中，掌心藤碗盛发光清水，周围绿根与黑腐根对抗。
8. `marsh-gas-vents`：龟裂湿泥喷出黄绿沼气，古老锈蚀炼金管和玻璃容器半埋，泥层下隐约金属箱与火星。
9. `root-prison`：巨型活树根围成囚笼，红毛狼形怪物与旧探险箱被封其中，树皮菌斑发出绿白脉光。
10. `blackwater-ferry`：空窄木渡船停在纯黑水岸，船头鹿骨灯、舱内湿苔货箱，斗篷摆渡人只作为水中倒影出现。
11. `firefly-grave-islet`：浅水包围的无名墓洲、风化木牌、金绿萤火引导光束与水边密封钱筒。
12. `frog-bone-oracle`：巨蛙骨与细藤组成占卜圆阵，中央湿石盘摆六枚趾骨，旁有旧供奉钱袋。
13. `mudbound-caravan`：三辆破货车斜陷泥潭，车轮与驮兽骨被树根吞没，包铁货箱和鼓起旧帆布仍露出泥面。
14. `sunken-witch-cauldron`：铜绿巨型坩埚陷在树根间，紫黑药液无火沸腾，周围悬挂药束、兽牙量勺与炼金瓶。
15. `ancient-crocodile-totem`：黑沼木与鳄骨组成巨型图腾，长吻含深绿宝石，浅水下鳄齿成排指向石台。
