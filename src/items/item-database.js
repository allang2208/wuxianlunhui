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
                    ring1: this.get('copper_ring'),
                    gloves: this.get('leather_gloves'),
                    ring2: this.get('iron_ring'),
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
                if (typeof CodexManager !== 'undefined' && CodexManager.refresh) {
                    CodexManager.refresh();
                }
            }
        };

export { ItemDatabase };
