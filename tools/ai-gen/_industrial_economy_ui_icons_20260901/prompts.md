# 近代经济科技与升级图标生成记录

## 生成方式

- 生成器：Codex 内置 `image_gen`
- 日期：2026-09-01
- 正式运行时图标由原始生成图经过确定性脚本裁切、缩放与 Alpha 规范化得到；脚本不重绘主体。
- 原始图保存在 `raw/`，规范化副本保存在 `final/`，运行时副本安装到 `assets/ui/technology-icons/` 与 `assets/ui/building-upgrades/`。
- `technology-manifest.json` 与 `upgrade-manifest.json` 记录每张图的原始文件名、尺寸、最终路径和 Alpha 边界。

## 共同风格参考

科技徽章参考：

- `assets/ui/technology-icons/steam_industry_standardization.png`
- `assets/ui/technology-icons/bakery_craft.png`
- `assets/ui/technology-icons/mall_standardization.png`

建筑升级卡参考：

- `assets/ui/building-upgrades/steam-high-pressure-boiler.png`
- `assets/ui/building-upgrades/grand-mall-showcase.png`
- `assets/ui/building-upgrades/solar-maintenance-staff.png`

建筑身份参考：

- `assets/terrain/oil_power_plant.png`
- `assets/terrain/cannery.png`
- `assets/terrain/trading_company.png`

## 科技徽章共同提示词

Create one premium cold-steel technology-tree badge for a dark industrial strategy-game UI. Use the supplied hexagonal technology icons as the exact style authority: centered isometric miniature, oxidized steel hex frame, restrained brass accents, deep charcoal-blue recess, realistic painted metal, crisp silhouette, strong readability at 64 and 48 pixels. Keep the subject fully inside the frame with generous safe margins. No words, letters, numbers, logos, watermark, smoke covering the subject, scenery, ground plane, or UI outside the badge. Square composition, transparent outside the badge.

六项主体说明：

- `industrial_energy_engineering`：双层燃油发电厂、明显独立烟囱、燃油储罐、粗管线和发电机组，少量深灰排放，突出“燃油动力”。
- `oil_power_standardization`：成对压力表、标准化管汇、阀门、燃烧室接口与检验标记结构，突出机组统一规范。
- `industrial_food_processing`：罐头加工厂的高温杀菌釜、传送带、封罐机和整齐金属罐，突出工业食品加工。
- `cannery_standardization`：三只规格一致的金属罐、卡尺式检具、封口压头和批次检验结构，突出标准化生产。
- `industrial_commerce`：近代贸易公司楼体、异形门头文字轮廓、货箱、合同卷宗和路线牌，突出企业贸易组织。
- `trading_standardization`：标准货箱、合同、路线箭头、印章与秤盘，突出统一合同、装运和结算规范。

## 建筑升级图标共同提示词

Create one premium square building-upgrade icon for the same dark cold-steel strategy-game UI. Match the supplied upgrade-card icons: centered single mechanism or compact symbolic assembly, oxidized steel rim, restrained brass fasteners, dark blue-black industrial recess, realistic painted metal, high local contrast, readable at 64 and 48 pixels. Use the supplied building image only for identity and material vocabulary. No text, letters, numbers, logo, watermark, characters, scenery, ground plane, or extra UI. Square composition with the subject entirely inside the safe area.

十二项主体说明：

- `oil-combustion-control`：燃烧室观察窗、可控火焰、阀门和调节连杆。
- `oil-generator-output`：重型发电机、铜绕组、转子和闪电形能量提示。
- `oil-fuel-efficiency`：燃油喷嘴将油滴雾化为细密扇形颗粒，配精密阀门。
- `oil-maintenance-staff`：交叉扳手、检修帽、齿轮和维护清单夹板。
- `cannery-assembly-line`：传送带、等距罐头、封罐压头和导轨。
- `cannery-food-output`：高温杀菌釜、温度表、蒸汽管和完整罐头。
- `cannery-energy-efficiency`：回流换热管、循环箭头、蒸汽与热交换器。
- `cannery-shift-staff`：轮班时钟、工帽、夹板和两组交接标记。
- `trading-contract-cycle`：卷起的合同、循环箭头、印章与计时齿轮。
- `trading-gold-output`：海外货箱、金币、船运路线牌和订单卷宗。
- `trading-food-efficiency`：保鲜货箱、密封罐、冷藏雪花和装运带。
- `trading-staff`：贸易职员帽、合同夹板、算盘和货箱。

## 后处理

- 科技徽章：`finalize_technology_icons.py` 复用既有科技树六边形几何蒙版，去除生成图棋盘背景并规范化为 1024×1024 RGBA。
- 升级图标：`finalize_upgrade_icons.py` 缩放为 256×256，并套用现有升级卡统一 Alpha 轮廓。
- 两类成品都把完全透明像素的 RGB 清零，避免缩放时产生色边。
- 本目录的两张 JPG 预览同时展示正式尺寸与 64/48px 小尺寸观感；未作游戏运行时验证。
