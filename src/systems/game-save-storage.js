// The save header, inventory/world snapshot, mail receipts and attachments commit
// in one IndexedDB transaction. localStorage is a read-only legacy fallback.
let databasePromise;
function database() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
        let cancelled = false;
        const request = indexedDB.open('infiniteLoop_player_save', 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            db.createObjectStore('snapshot');
            db.createObjectStore('mail', { keyPath: 'id' });
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => { cancelled = true; reject(new Error('存档升级被其他游戏窗口占用，请关闭旧窗口后重试')); };
        request.onsuccess = () => {
            const db = request.result;
            if (cancelled) { db.close(); return; }
            db.onversionchange = () => { db.close(); databasePromise = null; };
            resolve(db);
        };
    }).catch(error => { databasePromise = null; throw error; });
    return databasePromise;
}

export const GameSaveStorage = {
    async write(snapshot, mailbox) {
        // Capture everything before awaiting the database, while game state is still coherent.
        const frozen = JSON.parse(JSON.stringify({ snapshot, mailbox }));
        const db = await database();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(['snapshot', 'mail'], 'readwrite');
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error || new Error('存档事务被取消'));
            tx.onerror = () => {}; // onabort owns failure; never claim success on request completion.
            try {
                const { mails, ...mailHeader } = frozen.mailbox;
                tx.objectStore('snapshot').put({ ...frozen.snapshot, mailbox: mailHeader }, 'current');
                const store = tx.objectStore('mail');
                store.clear();
                for (const mail of mails) store.put(mail);
            } catch (error) {
                tx.abort();
                reject(error);
            }
        });
    },
    async read() {
        const db = await database();
        const stored = await new Promise((resolve, reject) => {
            const tx = db.transaction(['snapshot', 'mail'], 'readonly');
            const header = tx.objectStore('snapshot').get('current');
            const mails = tx.objectStore('mail').getAll();
            tx.oncomplete = () => resolve(header.result ? { ...header.result, mailbox: { ...header.result.mailbox, mails: mails.result } } : null);
            tx.onabort = () => reject(tx.error || new Error('存档读取失败'));
            tx.onerror = () => {};
        });
        if (stored) return stored;
        const legacy = localStorage.getItem('infiniteLoop_save');
        return legacy ? JSON.parse(legacy) : null;
    },
};
