# STG-44 / QBZ-95 音效来源与设计记录

## 交付方式

- 6 条音效均由 `generate-rifle-sounds.py` 以固定随机种子原创合成，未下载、截取或混入任何网络录音。
- 输出统一为 44.1 kHz、16-bit、双声道 WAV，开火声保持短尾，适配项目 `playGunshot` 高频并发通道。
- 网络资料只用于核对工作原理、射速、结构与声学方向；商业音效页面只用于确认常见素材拆分包含开火、换弹和操作声，不作为声音源。

## 研究依据

- STG-44：National Army Museum 记录 30 发弹匣、500–600 RPM；Australian War Memorial 记录导气式、选择射击与冲压金属结构；Forgotten Weapons 记录长行程活塞与倾斜枪栓。
- QBZ-95：Australian Army DATE 记录无托布局、短行程活塞、旋转枪栓、30 发弹匣、650 RPM 与 930 m/s 枪口初速；Forgotten Weapons 对 Type 97（QBZ-95 系列出口型）的拆解用于核对同族机件节奏。
- 定性参考页：Aftertouch Audio 与 Pond5 的 STG-44 产品页仅用来确认实录素材通常区分单发、换弹和操作声；本交付没有获取或复用其音频。

## 声音设计

### STG-44

- `stg44_fire.wav`（0.46 秒）：较厚的 80–320 Hz 爆压主体、偏暗枪口噪声；54–170 ms 加入长行程机件与冲压钢机匣的两段回响。
- `stg44_reload.wav`（1.60 秒）：弹匣释放、弧形钢弹匣抽出/插入、重座入、拉机柄与枪栓闭锁。
- `stg44_equip.wav`（0.72 秒）：木质枪托/背带摩擦、保险拨片、短拉机柄与钢件闭锁。

### QBZ-95

- `qbz95_fire.wav`（0.34 秒）：更亮、更短的 3–18.5 kHz 裂响，减弱低频拖尾；41 ms 起加入靠近射手耳部的紧凑短行程/旋转枪栓机件声。
- `qbz95_reload.wav`（1.25 秒）：后置弹匣释放、抽出/插入、卡笋、提把区域拉机柄与短促枪栓复位。
- `qbz95_equip.wav`（0.58 秒）：聚合物枪身操作、选择杆轻响、紧凑拉机柄与闭锁。

## 网络参考

- https://collection.nam.ac.uk/detail.php?acc=1996-08-248-1
- https://www.awm.gov.au/collection/C1081085
- https://www.forgottenweapons.com/mp-44-the-german-sturmgewehr/
- https://date.army.gov.au/equipment/qbz-95
- https://www.forgottenweapons.com/mechanics-and-disassembly-of-the-norinco-qbz-97-type-97-nsr/
- https://aftertouchaudio.com/product/stg-44/
- https://www.pond5.com/sound-effects/1/stg-44.html
