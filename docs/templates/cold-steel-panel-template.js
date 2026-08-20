/**
 * 冷钢档案右侧栏目模板
 *
 * 使用方法：
 * 1. 复制到 src/ui/panels/<business>-panel.js。
 * 2. 替换类名、id、stateKey、业务根类和文案。
 * 3. 保留 bp-right-column 通用根类；业务根类只负责业务专属布局。
 * 4. 建筑详情保留 buildingDetail 分组；普通栏目按需求移除该分组和外部点击关闭。
 * 5. 不直接修改本模板承载业务功能。
 */

import { BasePanel } from './base-panel.js';
import { mountRightSidebarPanel } from '../right-sidebar-panel-layer.js';

export class ExampleColdSteelPanel extends BasePanel {
    constructor() {
        super({
            id: 'exampleColdSteelPanel',
            className: 'example-cold-steel-panel bp-right-column',
            stateKey: 'exampleColdSteelPanel',
            panelGroup: 'buildingDetail',
            closeOnEscape: true,
            closeOnOutsidePointer: true,
            mountElement: (el) => mountRightSidebarPanel(el, 'panel', { bringToFront: true }),
        });
    }

    buildContent(el) {
        el.innerHTML = `
            <header class="bp-panel-header">
                <div class="bp-panel-header-copy">
                    <div class="bp-type-meta">分类 / 状态</div>
                    <h2 class="bp-type-title">面板标题</h2>
                </div>
                <button class="bp-panel-close" type="button" aria-label="关闭面板">×</button>
            </header>
            <div class="bp-panel-body">
                <section class="bp-panel-section">
                    <h3 class="bp-panel-section-title bp-type-subtitle">分区标题</h3>
                    <p class="bp-type-body">主要内容使用正文档位。</p>
                    <p class="bp-type-meta">状态、规则或成本说明使用辅助档位。</p>
                </section>
                <div class="bp-panel-actions">
                    <button class="bp-button" type="button" data-primary-action>主要操作</button>
                    <button class="bp-button bp-button--muted" type="button" data-secondary-action>次要操作</button>
                </div>
            </div>`;

        el.querySelector('.bp-panel-close')?.addEventListener('click', () => this.close());
        el.querySelector('[data-primary-action]')?.addEventListener('click', () => this._handlePrimaryAction());
        el.querySelector('[data-secondary-action]')?.addEventListener('click', () => this._handleSecondaryAction());
    }

    onOpen() {
        this.refresh();
    }

    refresh() {
        if (!this.el) return;
        // 只刷新数据和状态；不要重复构建 DOM 或重复绑定事件。
    }

    _handlePrimaryAction() {
        // 接入业务动作。
    }

    _handleSecondaryAction() {
        // 接入次要动作。
    }
}
