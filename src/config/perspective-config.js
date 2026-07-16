/**
 * 45° 俯视角透视配置
 *
 * 游戏逻辑仍使用正交 2D 坐标和圆形 groundRadius；显示端把地面圆形
 * 沿屏幕 Y 方向压缩为椭圆，使玩家看到的范围/阴影/碰撞框与逻辑体积匹配。
 */

// 地面圆在屏幕 Y 方向的压缩比：0.5 表示椭圆短轴为长轴的一半
export const PERSPECTIVE_SCALE_Y = 0.5;

// 垂直高度（z 轴）在屏幕 Y 方向的压缩比。
// 地面圆使用 PERSPECTIVE_SCALE_Y 做透视压缩，但实体贴图是 billboard（不受透视），
// 因此调试用的 3D 胶囊体高度按 1:1 匹配贴图高度，避免视觉上只有贴图一半高。
export const PERSPECTIVE_SCALE_Z = 1;
