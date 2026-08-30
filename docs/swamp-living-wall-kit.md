# 沼泽细碎枯枝墙

2026-08-30：用户明确确认“用这一版本”，当前四款细碎枯枝墙及拼接外观定稿，开发版已经使用。保留现有模型、贴图与固定种子，不重新生成或恢复粗根/横木/大扭结。已确认的藤蔓门原样保留；本段记录素材定稿时状态，后续首次固定EXE发布见 [测试版说明](exe-test-release.md)；本次确认是外观采用，实机通行与门端遮挡仍按约定由用户测试。确认记录见当前归档的 `manifest.json`。

## 造型与不变边界

| 款式 | 固定种子 | 碎枝排列倾向 |
|---|---|---|
| 碎枝随机 A | 831011 | 斜向散落，随机小簇与分叉 |
| 碎枝随机 B | 831077 | 相反斜向交错，独立簇位置 |
| 碎枝随机 C | 831149 | 更平缓的碎枝走向，局部乱枝 |
| 碎枝随机 D | 831233 | 偏竖向短枝，局部稍密 |

排列倾向叠加宽角度随机扰动，不制作粗大标志形状或工整栅栏。后层填充、侧缘接缝、贴地接触与顶部全部使用细枝；主枝基础半径上限0.042（含程序树皮起伏的最终表面半径会略大），面层主枝长度0.23～0.69模型单位。所有枝条是原生Blender渐细分叉网格，沿枝条方向的UV驱动程序PBR木纹；没有隐藏粗树干、石块、绿叶或苔藓色块。原版 `assets/terrain/swamp_wall_straight.png` 只作枯枝风格参考，不复用其像素。

四款共用细枝填充与接缝/接地骨架，面层按独立种子改变方向、分叉位置、局部簇位置和密度。制作随机结果写入贴图，运行时仍按世界坐标稳定选取四款，不引入逐帧随机、随机镜像、旋转或缩放。

- 固定脚点 `[512,761.9959]`、1024²画布、260×259显示尺寸、128×64单格占地、结构墙高132和碰撞半厚13。
- 仍沿等距轴 `(+64,+32)` / `(-64,+32)` 铺设，四角共享一格；保持世界坐标散列右移8位选款，禁止镜像/随机位移/随机缩放。
- 四款可见高度约162.886～166.427px；随机细梢形成轻微轮廓差异，自然枝条间的孔隙不表示可以通行。碰撞仍为原单格墙线，没有新增砍伐、资源或生长玩法。
- 沼泽三档、通道与实体宝箱房仍用 `swampStone`。历史数据文件名和纹理键 `swamp_living_block_a/b/c/d` 保留兼容，只替换四张墙图及来源/款式名称，不改预载与布局算法。
- 不修改路线、怪物、奖励、地板、房间尺寸或通道。

## 门口保护

制作脚本没有调用藤蔓门建模或渲染；合成脚本只读原门帧，只复制四张墙图。正式 `assets/terrain/swamp_stone_gate.png`、原门16帧、模型和动画参数未写入或替换；几何清单中的门登记沿用原值。

LT/RB（左上/右下）继续使用 `bindGateSourceCrop` 的源列裁片/负scaleX镜像、六段depth和端片退层。入口/通道/出口/宝箱门及轮廓运行时逻辑未改。枯枝墙端的自然孔隙与旧树冠不同，实际门端遮挡仍需用户在关闭/半开/全开状态观察；离线镜像拼装不能证明Phaser实机遮挡正确。

旧石柱合成脚本在植物墙或枯枝墙启用后均不允许整套安装覆盖。以后只调整藤蔓门须使用 `--install --gate-only`，仅替换门登记并保留当前墙配置。旧石柱脚本仅保留藤蔓门及共用建模/拼装函数；上一阶段绿植输出和废弃石柱图片已移入忽略的可恢复目录。门模型、16帧与几何来源继续保留。

## 文件与重建

- 运行时图片：`assets/terrain/swamp_living_block_a.png` 至 `_d.png`。
- 登记：`data/swamp-stone-wall-kit.json`、`public/data/swamp-stone-wall-kit.json`，版本5、`wallDesign: deadwood-thicket`；本轮仅版本和四款名称变化，所有几何/门字段不变。
- 接线：`src/world/wall-system.js` 与 `src/phaser/scenes/BootScene.js` 沿用前轮接线，本轮没有修改运行时代码。
- 制作：沿用文件名 `tools/ai-gen/build-swamp-living-wall-kit.py` 与 `compose-swamp-living-wall-kit.py`，当前输出为枯枝墙。复用旧沼泽/矿洞基础相机、Depth与拼装函数，保留这些源脚本依赖。
- 当前归档：`tools/ai-gen/_swamp_deadwood_wall_kit_20260830/` 含可编辑 `swamp_deadwood_wall_kit.blend`、四张PNG/Depth/Alpha、geometry、manifest、runtime清单、素材测量与预览。
- 废案清理清单：`docs/swamp-delivery-cleanup-20260830.json`；旧绿植与石柱输出不再上传，当前墙图、模型、Depth/Alpha、藤蔓门源帧及最终预览完整保留。
- 预览：`deadwood-wall-variants.jpg`（260×259原显示尺寸下的四款独立对照）、`deadwood-wall-overview.jpg`（四款、连续墙、转角、门端）、`deadwood-wall-floor-context.jpg`（闭环与既有地板）、`deadwood-wall-vine-gate.gif`（原藤蔓门帧与新墙搭配）。均为离线拼装，非实机截图；独立对照不是铺墙序列，连续墙混排与深度计算仍复用既有世界坐标散列/拼装函数。
- 说明/索引：本页、`docs/swamp-stone-wall-kit.md`、`SKILL.md`、`skill/06-dungeon-scene.md`、`CHANGELOG.md`。

```powershell
& 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --factory-startup --python tools/ai-gen/build-swamp-living-wall-kit.py
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/compose-swamp-living-wall-kit.py --install
```

不加 `--install` 只生成离线产物，不更新开发资源；两条命令均不发布EXE。

## 交付边界

离线素材制作记录：A/B/C/D的Alpha包围框分别为 `[250,118,774,856]`、`[250,114,774,856]`、`[250,104,774,868]`、`[250,114,774,856]`；主体中位亮度差0.00392、平均亮度差0.00375。共用相机和灯组，没有逐款曝光后处理；细梢轮廓变化不改变脚点/显示尺寸/占地，不能把可见孔隙作为可通行区域。

已查看本次真实差异与相关接线。未运行测试、构建、lint或运行时验证，按约定由用户测试；重点看连续墙/四角、LT/RB门端遮挡、角色靠墙和枯枝孔隙观感。Blender报告用户缩略图缓存写入失败，但模型与PNG输出完成；未因此变更用户环境。
