const EnhanceSystem = {
    _isOpen: false,

    open() {
        this._isOpen = true;
        const panel = document.getElementById('enhancePanel');
        if (panel) panel.style.display = 'flex';
    },

    close() {
        this._isOpen = false;
        const panel = document.getElementById('enhancePanel');
        if (panel) panel.style.display = 'none';
    },

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    }
};

export { EnhanceSystem };
