# 面包屋同级食物建筑 v01

本批只包含两个全新建筑，不把存量罐头厂或连锁餐馆计入数量。

- `desert_cookhouse` / 沙地炊坊：2×2三级加工建筑，沙漠夯土石墙、三座连体穹顶炉、固定遮阳棚、陶罐与干料架。计划机制为普通产能低于面包屋，但世界-122干旱期不受粮食减产。
- `frost_smokehouse` / 雪原熏制坊：2×2三级加工建筑，石木烟熏屋、单座陡坡雪顶、宽烟囱与连体熏制廊。计划机制为其他位面略弱、世界-123雪原获得1.35倍冷熏产出。

二者与`bakery_baking`同列，形成三级食物加工的三项并列选择；在当前远端科技基线上，两项新科技都以`dairy_husbandry + housing_optimization`作为共同前置，不提前改写尚未合入的农场分支或后续食品路线。

当前状态：`both_food_processors_runtime_integrated`。用户已于2026-09-02通过沙地炊坊白模，在12步三候选中选定`structure_v03_raw.png`，并由该完整原图完成标准48步两候选；用户于2026-09-03选定`refine_v01_raw.png`。正式透明素材已从这张完整原图重做：以完整Depth、`edge-pad 0`去掉生成图外部投影和右下绿色阴影尾巴，只保留屋檐、炉体、棚柱与基座内部的窄接触阴影；未使用会误删沙黄色结构的全图HSV透明清理。正式文件及透明棋盘复核图位于`desert_cookhouse/accepted_refine_v01_20260903/`，运行时主体、缩略图、1024px专属冷钢六边形科技徽章、四枚专属冷钢升级图标、昼夜光照图、地面拟合和主体投影均已接入；图标原稿、提示词和规范化脚本归档在`../_desert_cookhouse_icons_20260903/`。沙炉烹调科技、10岗位、四项本栋升级、前后台生产/存档/进度条及干旱最低100%粮食天气倍率已落地。

雪原熏制坊白模于2026-09-03获准，12步三候选中选定`structure_v02_raw.png`，48步两张精修中接受推荐的`refine_v01_raw.png`。正式透明素材仅移除边缘连通绿幕与封闭残绿，不用Depth硬裁，完整保留烟囱、雪顶、熏制廊和四角基座；正式文件及透明复核图位于`frost_smokehouse/accepted_refine_v01_20260903/`。运行时主体、缩略图、1024px专属冷钢六边形科技徽章、四枚专属冷钢升级图标、昼夜光照图、地面拟合和主体投影均已接入；寒地熏制科技、10岗位、四项本栋升级、前后台生产/存档/进度条及世界-123雪原×1.35、其他位面×0.85产出规则已落地。

定稿后已执行最小来源收口：两栋合计删除93个未选候选、阈值联系图、可再生`keyed/cleaned/anchored/preview`和重复白模预览，释放59,218,681字节；保留可编辑模型/构建脚本、当前Depth、唯一获准12/48步raw与生成记录、直接Alpha源、正式cutout/透明复核图、阴影代理和运行时元数据。活动manifest只指向现存正式链。

重建命令：

```powershell
$blender = 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe'
$root = 'tools/ai-gen/_food_processors_20260902'
foreach ($id in @('desert_cookhouse', 'frost_smokehouse')) {
  New-Item -ItemType Directory -Force -Path "$root/$id" | Out-Null
  & $blender --background --factory-startup --threads 8 --python "$root/build-models.py" -- "$root/manifest.json" $id "$root/$id/${id}_model.blend" "$root/$id/${id}_model_preview.png" "$root/$id/${id}_depth.png" "$root/$id/${id}_body_depth.png"
}
```
