// Immutable records: inventory transactions can keep/restore the previous state without
// cloning every attachment. No NPC, scene or DOM lifetime owns the mailbox.
let sequence = 0;
export function mailId(prefix = 'mail') {
    return `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`}`;
}
export const copyMailData = value => JSON.parse(JSON.stringify(value));

export const MailStore = {
    state: { mails: [], receipts: new Set(), run: null },
    listeners: new Set(),
    get run() { return this.state.run; },
    get pendingCount() { return this.state.mails.filter(mail => mail.attachments.length > 0).length; },
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); },
    notify(reason = 'changed', payload = null) {
        for (const listener of this.listeners) {
            try { listener(reason, payload); } catch (error) { console.warn('[Mailbox] display refresh failed', error); }
        }
    },
    beginRun(title) {
        if (this.run?.status === 'active') throw new Error('上次探险尚未结算，不能覆盖暂存战利品');
        this.state = { ...this.state, run: { id: mailId('run'), title, status: 'active', pending: [] } };
        this.notify();
    },
    read(id) {
        const mail = this.state.mails.find(entry => entry.id === id);
        if (!mail || mail.read) return false;
        this.state = { ...this.state, mails: this.state.mails.map(mail => mail.id === id ? { ...mail, read: true } : mail) };
        this.notify('read', { id });
        return true;
    },
    clearClaimed() {
        this.state = { ...this.state, mails: this.state.mails.filter(mail => mail.attachments.length > 0) };
        // Receipts intentionally survive removal of an empty letter.
        this.notify();
    },
    serialize() {
        return copyMailData({ version: 1, mails: this.state.mails, receipts: [...this.state.receipts], run: this.run });
    },
    prepareRestore(data) {
        if (!data) return { mails: [], receipts: new Set(), run: null };
        if (data.version !== 1 || !Array.isArray(data.mails) || !Array.isArray(data.receipts)) {
            throw new Error('信箱存档格式无效，未覆盖当前信箱');
        }
        const clean = copyMailData(data);
        const ids = new Set();
        for (const mail of clean.mails) {
            if (!mail?.id || ids.has(mail.id) || !Array.isArray(mail.attachments)) throw new Error('信件记录损坏');
            ids.add(mail.id);
            const attachmentIds = new Set();
            for (const attachment of mail.attachments) {
                if (!attachment?.id || attachmentIds.has(attachment.id) || !attachment.item?.name
                    || !Number.isSafeInteger(attachment.item.stack) || attachment.item.stack <= 0) {
                    throw new Error('信件附件损坏，未丢弃或截断附件');
                }
                attachmentIds.add(attachment.id);
            }
        }
        if (clean.run?.status === 'active') throw new Error('此存档包含未完成探险，当前版本不支持地牢中途读档');
        return { mails: clean.mails, receipts: new Set(clean.receipts), run: clean.run || null };
    },
    restorePrepared(state) { this.state = state; this.notify('restore'); },
};
