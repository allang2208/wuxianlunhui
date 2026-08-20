import { EventBus } from '../core/event-bus.js';
import { TechnologySystem } from '../world/technology-system.js';

const bindings = new Map();
let initialized = false;

function captureBaseline(element) {
    return {
        display: element.style.display,
        visibility: element.style.visibility,
        pointerEvents: element.style.pointerEvents,
        disabled: 'disabled' in element ? !!element.disabled : null,
        tabIndexAttribute: element.getAttribute('tabindex'),
        ariaHidden: element.getAttribute('aria-hidden'),
        inert: 'inert' in element ? !!element.inert : null,
    };
}

function restoreAttribute(element, name, value) {
    if (value == null) element.removeAttribute(name);
    else element.setAttribute(name, value);
}

function ensureInitialized() {
    if (initialized) return;
    initialized = true;
    EventBus.on('technology:changed', () => TechnologyGate.refreshAll());
}

export const TechnologyGate = {
    bind(element, {
        type,
        id,
        preserveLayout = true,
        when = null,
    } = {}) {
        if (!element || !type || !id) return element;
        ensureInitialized();
        const existing = bindings.get(element);
        const binding = existing || {
            element,
            baseline: captureBaseline(element),
        };
        binding.type = type;
        binding.id = id;
        binding.preserveLayout = preserveLayout !== false;
        binding.when = typeof when === 'function' ? when : null;
        bindings.set(element, binding);
        this.refresh(element);
        return element;
    },

    bindTree(root) {
        if (!root?.querySelectorAll) return 0;
        const elements = [];
        if (root.matches?.('[data-technology-gate-type][data-technology-gate-id]')) elements.push(root);
        elements.push(...root.querySelectorAll('[data-technology-gate-type][data-technology-gate-id]'));
        for (const element of elements) {
            this.bind(element, {
                type: element.dataset.technologyGateType,
                id: element.dataset.technologyGateId,
                preserveLayout: element.dataset.technologyGateLayout !== 'collapse',
            });
        }
        return elements.length;
    },

    refresh(element) {
        const binding = bindings.get(element);
        if (!binding) return true;
        const unlocked = TechnologySystem.isUnlocked(binding.type, binding.id)
            && (!binding.when || binding.when());
        const { baseline } = binding;

        if (unlocked) {
            element.style.display = baseline.display;
            element.style.visibility = baseline.visibility;
            element.style.pointerEvents = baseline.pointerEvents;
            if (baseline.disabled != null) element.disabled = baseline.disabled;
            restoreAttribute(element, 'tabindex', baseline.tabIndexAttribute);
            restoreAttribute(element, 'aria-hidden', baseline.ariaHidden);
            if (baseline.inert != null) element.inert = baseline.inert;
            element.classList.remove('technology-gated-hidden');
            return true;
        }

        if (binding.preserveLayout) {
            element.style.display = baseline.display;
            element.style.visibility = 'hidden';
        } else {
            element.style.display = 'none';
            element.style.visibility = baseline.visibility;
        }
        element.style.pointerEvents = 'none';
        if (baseline.disabled != null) element.disabled = true;
        element.setAttribute('tabindex', '-1');
        element.setAttribute('aria-hidden', 'true');
        if (baseline.inert != null) element.inert = true;
        element.classList.add('technology-gated-hidden');
        return false;
    },

    refreshAll() {
        for (const [element] of bindings) {
            if (!element.isConnected) {
                bindings.delete(element);
                continue;
            }
            this.refresh(element);
        }
    },

    unbind(element) {
        const binding = bindings.get(element);
        if (!binding) return false;
        const { baseline } = binding;
        element.style.display = baseline.display;
        element.style.visibility = baseline.visibility;
        element.style.pointerEvents = baseline.pointerEvents;
        if (baseline.disabled != null) element.disabled = baseline.disabled;
        restoreAttribute(element, 'tabindex', baseline.tabIndexAttribute);
        restoreAttribute(element, 'aria-hidden', baseline.ariaHidden);
        if (baseline.inert != null) element.inert = baseline.inert;
        element.classList.remove('technology-gated-hidden');
        bindings.delete(element);
        return true;
    },
};
