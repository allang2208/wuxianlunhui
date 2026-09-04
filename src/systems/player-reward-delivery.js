import { EquipManager } from '../ui/equip-manager.js';
import { WarehouseSystem } from '../ui/warehouse-system.js';
import { completeWeaponFields } from '../ui/equip-data-manager.js';
import { getItemMaxStack, isGoldItem, syncGoldStackPresentation } from '../items/item-stack-rules.js';
import { MailStore, copyMailData, mailId } from './mail-store.js';
import { TopNotificationQueue } from '../ui/top-notification-queue.js';
import { TimerManager } from '../utils/timer-manager.js';
import { EventBus } from '../core/event-bus.js';

function normalize(item) {
    const clone = copyMailData(item);
    if (!clone?.name || clone.category === 'energy') throw new Error('该物品不能进入玩家奖励信箱');
    clone.stack = Number(clone.stack ?? 1);
    if (!Number.isSafeInteger(clone.stack) || clone.stack <= 0) throw new Error('附件数量无效');
    delete clone.slot;
    completeWeaponFields(clone);
    if (isGoldItem(clone)) syncGoldStackPresentation(clone);
    return clone;
}

function remainderItem(item, stack) {
    const remaining = { ...item, stack };
    return isGoldItem(remaining) ? syncGoldStackPresentation(remaining) : remaining;
}

function summarizeAttachments(attachments) {
    const totals = new Map();
    for (const attachment of attachments || []) {
        const item = attachment?.item;
        if (!item?.name) continue;
        totals.set(item.name, (totals.get(item.name) || 0) + Math.max(1, Number(item.stack) || 1));
    }
    const entries = [...totals.entries()];
    const visible = entries.slice(0, 2).map(([name, stack]) => `${name}${stack > 1 ? ` ×${stack}` : ''}`).join('、');
    return `${visible || '战利品'}${entries.length > 2 ? `等 ${entries.length} 种物品` : ''}`;
}

// Plan into private container copies. Existing addToBackpack(false) may already have
// merged some stacks, so it must not be used as an all-or-nothing delivery primitive.
function putInto(target, capacity, item) {
    const maxStack = getItemMaxStack(item);
    // GoldManager consolidates all gold in a container to one safe-integer total.
    // Never spill beyond that total into a second stack that consolidation would truncate.
    const goldTotal = isGoldItem(item) ? target.reduce((sum, entry) => isGoldItem(entry)
        ? Math.min(maxStack, sum + Math.max(0, Number(entry.stack) || 0)) : sum, 0) : 0;
    const writable = isGoldItem(item) ? Math.min(item.stack, Math.max(0, maxStack - goldTotal)) : item.stack;
    let remaining = writable;
    if (maxStack > 1) {
        for (const existing of target) {
            if (existing.name !== item.name || getItemMaxStack(existing) <= 1) continue;
            const accepted = Math.min(remaining, Math.max(0, maxStack - (existing.stack || 1)));
            existing.stack = (existing.stack || 1) + accepted;
            if (isGoldItem(existing)) syncGoldStackPresentation(existing);
            remaining -= accepted;
            if (!remaining) break;
        }
    }
    const used = new Set(target.map(entry => entry.slot));
    for (let slot = 0; remaining > 0 && slot < capacity; slot++) {
        if (used.has(slot)) continue;
        const accepted = Math.min(remaining, maxStack);
        const entry = { ...copyMailData(item), stack: accepted, slot };
        if (isGoldItem(entry)) syncGoldStackPresentation(entry);
        target.push(entry);
        remaining -= accepted;
    }
    return writable - remaining;
}

export const PlayerRewardDelivery = {
    _notice: null,
    _noticeTimer: null,
    _refresh() {
        try { EquipManager.updateInventorySlots?.(); } catch (error) { console.warn('[Mailbox] inventory display', error); }
        try { WarehouseSystem._refreshAll?.(); } catch (error) { console.warn('[Mailbox] warehouse display', error); }
        MailStore.notify();
    },
    _commit(backpack, warehouse, state) {
        // No asynchronous work or callbacks between the three ownership transfers.
        EquipManager.backpackItems.splice(0, EquipManager.backpackItems.length, ...backpack);
        WarehouseSystem.items.splice(0, WarehouseSystem.items.length, ...warehouse);
        MailStore.state = state;
        this._refresh();
    },
    _notify(result, createdMail = null) {
        if (!result.pending && !result.mailed) return;
        if (!this._notice) this._notice = { pending: 0, mailed: 0, mailIds: [], attachments: [] };
        this._notice.pending += result.pending;
        this._notice.mailed += result.mailed;
        if (createdMail) {
            this._notice.mailIds.push(createdMail.id);
            this._notice.attachments.push(...createdMail.attachments);
        }
        if (this._noticeTimer !== null) return;
        this._noticeTimer = TimerManager.setTimeout(() => {
            const notice = this._notice;
            this._notice = null;
            this._noticeTimer = null;
            if (notice?.pending) TopNotificationQueue.show(`战利品已暂存 ${notice.pending} 项；通关或安全撤离后领取，死亡/放弃会损失`, { tone: 'warning' });
            if (notice?.mailed) {
                const mailIds = [...new Set(notice.mailIds)];
                const summary = summarizeAttachments(notice.attachments);
                TopNotificationQueue.show(`背包和仓库空间不足，${summary}已进入信箱，请找小鼠大王领取`, {
                    tone: 'success',
                    onComplete: () => EventBus.emit('mailbox:report-ready', { mailIds }),
                });
            }
        }, 400);
    },
    deliver(items, { sourceId = mailId('reward'), title = '战利品寄存', finishRun = false,
        outcome = 'success', notify = true, deferDuringRun = true } = {}) {
        if (MailStore.state.receipts.has(sourceId)) return { ok: true, duplicate: true, backpack: 0, warehouse: 0, pending: 0, mailed: 0 };
        const run = MailStore.run;
        const release = finishRun && run?.status === 'active';
        const list = [...(release ? run.pending.map(entry => entry.item) : []), ...items].map(normalize);
        const backpack = copyMailData(EquipManager.backpackItems || []);
        const warehouse = copyMailData(WarehouseSystem.items || []);
        const attachments = [];
        const result = { ok: true, backpack: 0, warehouse: 0, pending: 0, mailed: 0 };
        const defer = deferDuringRun && run?.status === 'active' && !finishRun;
        for (const item of list) {
            let remaining = item.stack;
            const received = putInto(backpack, EquipManager.maxBackpackSlots, item);
            remaining -= received;
            if (received) result.backpack++;
            if (remaining && !defer) {
                const stored = putInto(warehouse, WarehouseSystem.capacity, { ...item, stack: remaining });
                remaining -= stored;
                if (stored) result.warehouse++;
            }
            if (remaining) attachments.push({ id: mailId('attachment'), item: remainderItem(item, remaining) });
        }
        let nextRun = run;
        let mails = MailStore.state.mails;
        let createdMail = null;
        if (defer && attachments.length) {
            result.pending = attachments.length;
            nextRun = { ...run, pending: [...run.pending, ...attachments] };
        } else if (attachments.length) {
            result.mailed = attachments.length;
            createdMail = { id: mailId(), sourceId, title, createdAt: Date.now(), read: false, attachments };
            mails = [...mails, createdMail];
        }
        if (release) {
            nextRun = { ...run, status: 'released', outcome, pending: [] };
            if (this._notice) this._notice.pending = 0;
        }
        const receipts = new Set(MailStore.state.receipts);
        receipts.add(sourceId);
        this._commit(backpack, warehouse, { mails, receipts, run: nextRun });
        if (notify) {
            try { this._notify(result, createdMail); } catch (error) { console.warn('[Mailbox] notice failed after delivery', error); }
        }
        return result;
    },
    finishRun(outcome) {
        const run = MailStore.run;
        if (!run || run.status !== 'active') return;
        if (['success', 'safe_evac', 'load_failure'].includes(outcome)) {
            return this.deliver([], { sourceId: `${run.id}:exit`, title: `${run.title} · 战利品`, finishRun: true, outcome });
        }
        MailStore.state = { ...MailStore.state, run: { ...run, status: 'lost', outcome, pending: [] } };
        if (this._notice) this._notice.pending = 0;
        MailStore.notify();
    },
    canMailDrop(entity) { return entity?._rewardSource?.kind === 'loot' && entity.itemData?.category !== 'energy'; },
    preview(items) {
        const backpack = copyMailData(EquipManager.backpackItems || []);
        const warehouse = copyMailData(WarehouseSystem.items || []);
        return items.map(source => {
            const item = normalize(source);
            const bag = putInto(backpack, EquipManager.maxBackpackSlots, item);
            const stored = bag < item.stack ? putInto(warehouse, WarehouseSystem.capacity, { ...item, stack: item.stack - bag }) : 0;
            return bag + stored;
        });
    },
    pickup(entity) {
        if (!this.canMailDrop(entity)) return EquipManager.addToBackpack(entity.itemData);
        try {
            return this.deliver([entity.itemData], { sourceId: entity._rewardSource.id, title: '拾取战利品' }).ok;
        } catch (error) {
            console.error('[Mailbox] 拾取失败，原掉落保留', error);
            return false;
        }
    },
    claim(mailIdValue, attachmentId = null) {
        const mail = MailStore.state.mails.find(entry => entry.id === mailIdValue);
        if (!mail) return { received: 0, remaining: 0 };
        const backpack = copyMailData(EquipManager.backpackItems || []);
        const warehouse = copyMailData(WarehouseSystem.items || []);
        const attachments = [];
        let received = 0;
        for (const attachment of mail.attachments) {
            if (attachmentId && attachment.id !== attachmentId) { attachments.push(attachment); continue; }
            const item = normalize(attachment.item);
            let remaining = item.stack;
            remaining -= putInto(backpack, EquipManager.maxBackpackSlots, item);
            if (remaining) remaining -= putInto(warehouse, WarehouseSystem.capacity, { ...item, stack: remaining });
            if (remaining < item.stack) received++;
            if (remaining) attachments.push({ ...attachment, item: remainderItem(item, remaining) });
        }
        this._commit(backpack, warehouse, { ...MailStore.state,
            mails: MailStore.state.mails.map(entry => entry.id === mail.id ? { ...mail, read: true, claimed: mail.claimed || received > 0, attachments } : entry) });
        return { received, remaining: attachments.length };
    },
};
