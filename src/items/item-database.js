        const ItemDatabase = {
            items: {},

            /** 从 JSON 数据加载装备（data 为 {id: item} 对象） */
            load(data) {
                if (data) {
                    this.items = data;
                }
            },

            get(id) { return this.items[id] ? { ...this.items[id], _id: id } : null; },
            getDefaultEquip() {
                return {
                    helmet: this.get('novice_cap'),
                    necklace: this.get('rough_necklace'),
                    weapon: this.get('rusty_sword'),
                    armor: this.get('old_leather_armor'),
                    offhand: this.get('old_wooden_shield'),
                    ring1: null,
                    gloves: this.get('leather_gloves'),
                    ring2: null,
                    belt: this.get('basic_belt'),
                    boots: this.get('old_leather_boots')
                };
            },
            getDefaultBackpack() {
                return [
                    { ...this.get('hp_potion'), slot: 0 },
                    { ...this.get('mp_potion'), slot: 1 }
                ];
            },
            /** 新增物品并同步刷新图鉴 */
            addItem(id, itemData) {
                this.items[id] = itemData;
                // 动态导入避免与 codex-manager 形成循环依赖
                import('../ui/codex-manager.js').then(m => {
                    if (m.CodexManager && m.CodexManager.refresh) {
                        m.CodexManager.refresh();
                    }
                }).catch(() => {});
            },

            /** 创建物品实例（深拷贝并生成唯一实例ID） */
            createInstance(id, extra = {}) {
                const base = this.get(id);
                if (!base) return null;
                return {
                    ...JSON.parse(JSON.stringify(base)),
                    instanceId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    ...extra
                };
            },

            /** 按稀有度随机抽取一件武器 */
            getRandomWeaponByRarity(rarity) {
                const weapons = Object.keys(this.items).filter(key => {
                    const item = this.items[key];
                    return item && item.rarity === rarity && item.category && item.category.startsWith('weapon');
                });
                if (weapons.length === 0) return null;
                const key = weapons[Math.floor(Math.random() * weapons.length)];
                return this.createInstance(key);
            },

            /** 按稀有度随机抽取多件装备 */
            getRandomItemsByRarity(rarity, count = 1) {
                const candidates = Object.keys(this.items).filter(key => {
                    const item = this.items[key];
                    return item && item.rarity === rarity;
                });
                const results = [];
                for (let i = 0; i < count && candidates.length > 0; i++) {
                    const idx = Math.floor(Math.random() * candidates.length);
                    const key = candidates[idx];
                    results.push(this.createInstance(key));
                }
                return results;
            }
        };

export { ItemDatabase };
