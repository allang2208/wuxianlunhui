// 怪物贴图调整工具
const EnemySpriteTool = {
    _panel: null,
    _canvas: null,
    _ctx: null,
    _currentEnemy: 'blackWolf', // 当前选中的怪物
    _currentDirection: 'right', // 当前选中的方向
    _images: {},
    
    // 怪物列表（从 enemy-config.json 中读取的 key）
    ENEMY_LIST: [
        { key: 'blackWolf', name: '黑狼' },
        { key: 'spider', name: '蜘蛛' },
        { key: 'fatZombie', name: '肥僵尸' },
        { key: 'slime', name: '史莱姆' },
        { key: 'mushroom', name: '蘑菇怪' },
        { key: 'bat', name: '蝙蝠' },
        { key: 'skeleton', name: '骷髅' },
        { key: 'ghost', name: '幽灵' },
        { key: 'wolf', name: '灰狼' },
        { key: 'goblin', name: '哥布林' },
        { key: 'demon', name: '恶魔' },
        { key: 'dragon', name: '龙' },
        { key: 'lich', name: '巫妖' },
        { key: 'bigBoss', name: '大Boss' },
    ],
    
    // 方向列表
    DIRECTIONS: [
        { key: 'right', name: '右' },
        { key: 'left', name: '左' },
        { key: 'up', name: '上' },
        { key: 'down', name: '下' },
    ],
    
    // 可选择的精灵图列表
    SPRITE_LIST: [
        { key: 'enemy_black_wolf', name: '黑狼（移动）', path: 'assets/enemies/black_wolf.png', frames: 8, cols: 4, rows: 2 },
        { key: 'enemy_black_wolf_attack', name: '黑狼（攻击）', path: 'assets/enemies/black_wolf_attack.png', frames: 8, cols: 4, rows: 2 },
        { key: 'enemy_spider', name: '蜘蛛', path: 'assets/enemies/spider.png', frames: 1, cols: 1, rows: 1 },
        { key: 'enemy_slime', name: '史莱姆', path: 'assets/enemies/slime.png', frames: 1, cols: 1, rows: 1 },
        { key: 'enemy_skeleton', name: '骷髅', path: 'assets/enemies/skeleton.png', frames: 1, cols: 1, rows: 1 },
        { key: 'enemy_ghost', name: '幽灵', path: 'assets/enemies/ghost.png', frames: 1, cols: 1, rows: 1 },
    ],
    
    // 调整数据（每个怪物每个方向一组参数）
    // 格式: { enemyKey: { right: {textureKey, size, rotation, flipX, flipY}, ... } }
    data: {},
    
    // 默认参数
    defaultParams: {
        textureKey: 'enemy_black_wolf',
        size: 216,
        rotation: 0,
        flipX: false,
        flipY: false,
    },
    
    init() {
        this._loadData();
        this._loadImages();
        this._bindEvents();
        this._syncUI();
        this._draw();
    },
    
    // 从 localStorage 加载数据
    _loadData() {
        const saved = localStorage.getItem('enemySpriteToolData');
        if (saved) {
            try {
                this.data = JSON.parse(saved);
            } catch(e) {
                console.warn('[EnemySpriteTool] 加载数据失败:', e);
                this.data = {};
            }
        }
    },
    
    // 保存到 localStorage
    _saveData() {
        localStorage.setItem('enemySpriteToolData', JSON.stringify(this.data));
    },
    
    // 加载所有精灵图
    _loadImages() {
        for (const sprite of this.SPRITE_LIST) {
            const img = new Image();
            img.src = sprite.path;
            img.onload = () => this._draw();
            this._images[sprite.key] = img;
        }
    },
    
    // 获取指定怪物方向的参数
    _getParams(enemyKey, direction) {
        if (!this.data[enemyKey]) this.data[enemyKey] = {};
        if (!this.data[enemyKey][direction]) {
            this.data[enemyKey][direction] = { ...this.defaultParams };
        }
        return this.data[enemyKey][direction];
    },
    
    // 绑定事件
    _bindEvents() {
        // 怪物选择
        const enemySelect = document.getElementById('enemySpriteSelect');
        if (enemySelect) {
            enemySelect.addEventListener('change', (e) => {
                this._currentEnemy = e.target.value;
                this._syncUI();
                this._draw();
            });
        }
        
        // 方向选择按钮
        document.querySelectorAll('.enemy-direction-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this._currentDirection = e.target.dataset.dir;
                this._updateDirectionButtons();
                this._syncUI();
                this._draw();
            });
        });
        
        // 精灵图选择
        const textureSelect = document.getElementById('enemySpriteTexture');
        if (textureSelect) {
            textureSelect.addEventListener('change', (e) => {
                const params = this._getParams(this._currentEnemy, this._currentDirection);
                params.textureKey = e.target.value;
                this._saveData();
                this._draw();
            });
        }
        
        // 大小
        const sizeInput = document.getElementById('enemySpriteSize');
        if (sizeInput) {
            sizeInput.addEventListener('input', (e) => {
                const params = this._getParams(this._currentEnemy, this._currentDirection);
                params.size = parseInt(e.target.value) || 216;
                this._saveData();
                this._draw();
            });
        }
        
        // 旋转角度
        const rotInput = document.getElementById('enemySpriteRotation');
        if (rotInput) {
            rotInput.addEventListener('input', (e) => {
                const params = this._getParams(this._currentEnemy, this._currentDirection);
                params.rotation = parseInt(e.target.value) || 0;
                this._saveData();
                this._draw();
            });
        }
        
        // 水平翻转
        const flipXInput = document.getElementById('enemySpriteFlipX');
        if (flipXInput) {
            flipXInput.addEventListener('change', (e) => {
                const params = this._getParams(this._currentEnemy, this._currentDirection);
                params.flipX = e.target.checked;
                this._saveData();
                this._draw();
            });
        }
        
        // 垂直翻转
        const flipYInput = document.getElementById('enemySpriteFlipY');
        if (flipYInput) {
            flipYInput.addEventListener('change', (e) => {
                const params = this._getParams(this._currentEnemy, this._currentDirection);
                params.flipY = e.target.checked;
                this._saveData();
                this._draw();
            });
        }
        
        // 保存按钮
        const saveBtn = document.getElementById('enemySpriteSave');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this._export());
        }
        
        // 加载按钮
        const loadBtn = document.getElementById('enemySpriteLoad');
        if (loadBtn) {
            loadBtn.addEventListener('click', () => this._import());
        }
        
        // 重置当前方向
        const resetBtn = document.getElementById('enemySpriteReset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                const params = this._getParams(this._currentEnemy, this._currentDirection);
                Object.assign(params, this.defaultParams);
                this._saveData();
                this._syncUI();
                this._draw();
            });
        }
    },
    
    // 更新方向按钮状态
    _updateDirectionButtons() {
        document.querySelectorAll('.enemy-direction-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.dir === this._currentDirection);
        });
    },
    
    // 同步 UI 控件到当前数据
    _syncUI() {
        const params = this._getParams(this._currentEnemy, this._currentDirection);
        
        const textureSelect = document.getElementById('enemySpriteTexture');
        if (textureSelect) textureSelect.value = params.textureKey;
        
        const sizeInput = document.getElementById('enemySpriteSize');
        if (sizeInput) sizeInput.value = params.size;
        
        const rotInput = document.getElementById('enemySpriteRotation');
        if (rotInput) rotInput.value = params.rotation;
        
        const flipXInput = document.getElementById('enemySpriteFlipX');
        if (flipXInput) flipXInput.checked = params.flipX;
        
        const flipYInput = document.getElementById('enemySpriteFlipY');
        if (flipYInput) flipYInput.checked = params.flipY;
        
        this._updateDirectionButtons();
    },
    
    // 绘制预览
    _draw() {
        const canvas = document.getElementById('enemySpriteCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        
        ctx.clearRect(0, 0, w, h);
        
        // 背景
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, w, h);
        
        // 网格
        ctx.strokeStyle = 'rgba(80, 80, 80, 0.2)';
        ctx.lineWidth = 1;
        for (let i = 0; i < w; i += 20) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
        for (let i = 0; i < h; i += 20) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
        
        // 中心十字线
        const cx = w / 2;
        const cy = h / 2;
        ctx.strokeStyle = 'rgba(100, 200, 100, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
        
        // 绘制当前方向的精灵图
        const params = this._getParams(this._currentEnemy, this._currentDirection);
        const sprite = this._getSpriteConfig(params.textureKey);
        const img = this._images[params.textureKey];
        
        if (img && img.complete && img.naturalWidth > 0) {
            const size = params.size || 216;
            const rotation = (params.rotation || 0) * Math.PI / 180;
            
            ctx.save();
            ctx.translate(cx, cy);
            
            // 应用变换
            if (params.flipX) ctx.scale(-1, 1);
            if (params.flipY) ctx.scale(1, -1);
            ctx.rotate(rotation);
            
            // 绘制第一帧
            const cols = sprite ? sprite.cols : 4;
            const rows = sprite ? sprite.rows : 2;
            const frameW = img.naturalWidth / cols;
            const frameH = img.naturalHeight / rows;
            ctx.drawImage(
                img,
                0, 0, frameW, frameH,
                -size / 2, -size / 2, size, size
            );
            
            ctx.restore();
        } else {
            // 绘制占位图
            ctx.fillStyle = '#5a4d3f';
            ctx.fillRect(cx - 50, cy - 50, 100, 100);
            ctx.fillStyle = '#8a7d6b';
            ctx.font = '12px SimHei';
            ctx.textAlign = 'center';
            ctx.fillText('加载中...', cx, cy);
        }
        
        // 绘制方向标注
        ctx.fillStyle = '#a0907a';
        ctx.font = '11px SimHei';
        ctx.textAlign = 'left';
        ctx.fillText(`当前: ${this._getEnemyName(this._currentEnemy)} ${this._getDirectionName(this._currentDirection)}`, 10, 18);
        ctx.fillText(`纹理: ${params.textureKey}`, 10, 36);
        ctx.fillText(`大小: ${params.size}px`, 10, 54);
        ctx.fillText(`旋转: ${params.rotation}°`, 10, 72);
        ctx.fillText(`翻转: ${params.flipX ? 'X' : ''}${params.flipY ? 'Y' : ''}`, 10, 90);
    },
    
    _getSpriteConfig(key) {
        return this.SPRITE_LIST.find(s => s.key === key);
    },
    
    _getEnemyName(key) {
        const e = this.ENEMY_LIST.find(e => e.key === key);
        return e ? e.name : key;
    },
    
    _getDirectionName(key) {
        const d = this.DIRECTIONS.find(d => d.key === key);
        return d ? d.name : key;
    },
    
    // 导出 JSON 到剪贴板
    _export() {
        const json = JSON.stringify(this.data, null, 2);
        navigator.clipboard.writeText(json).then(() => {
            this._showToast('✅ 已复制到剪贴板');
        }).catch(() => {
            const output = document.getElementById('enemySpriteOutput');
            if (output) {
                output.textContent = json;
                output.style.display = 'block';
            }
            this._showToast('✅ 已输出到下方');
        });
    },
    
    // 从 JSON 导入
    _import() {
        const input = prompt('粘贴 JSON 数据:');
        if (!input) return;
        try {
            const data = JSON.parse(input);
            this.data = data;
            this._saveData();
            this._syncUI();
            this._draw();
            this._showToast('✅ 已加载');
        } catch(e) {
            alert('JSON 解析失败: ' + e.message);
        }
    },
    
    // 获取当前数据（供主代码调用）
    getData() {
        return this.data;
    },
    
    // 获取指定怪物方向的参数（供主代码调用）
    getParams(enemyKey, direction) {
        return this._getParams(enemyKey, direction);
    },
    
    _showToast(message) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(40,60,30,0.95);color:#90d070;padding:10px 20px;border-radius:6px;font-size:14px;z-index:10000;pointer-events:none;animation:toastFade 2s ease-out forwards;font-family:SimHei,"Microsoft YaHei",sans-serif;border:1px solid rgba(144,208,112,0.3);';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2000);
    },
};

export { EnemySpriteTool };
