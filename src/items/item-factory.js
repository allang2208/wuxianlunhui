        const ItemFactory = {
            _nextId: 1,
            generateId() { return 'item_' + Date.now() + '_' + (this._nextId++); },
            /** 从模板创建全新的独立物品实例 */
            create(template) {
                const instance = JSON.parse(JSON.stringify(template)); // 深拷贝，完全独立
                instance.itemId = this.generateId();
                instance.createdAt = Date.now();
                delete instance.slot; // 清除模板中的slot占位
                return instance;
            },
            /** 克隆已有实例（卸下装备时），分配新ID */
            clone(itemInstance) {
                const clone = JSON.parse(JSON.stringify(itemInstance));
                clone.itemId = this.generateId();
                clone.createdAt = Date.now();
                delete clone.slot;
                return clone;
            }
        };


export { ItemFactory };
