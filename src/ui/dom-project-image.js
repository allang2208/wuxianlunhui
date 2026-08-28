const RUNTIME_ICON_ROOT = 'assets/ui/runtime-icons/';
const PROJECT_IMAGE_SELECTOR = 'img[data-project-image="true"]';

let fallbackHandlerInstalled = false;

function escapeAttribute(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function normalizeSource(source) {
    return String(source || '').trim().replaceAll('\\', '/');
}

/**
 * 项目图标保留正式原图路径，DOM 只读取镜像目录中的 128px 运行时副本。
 * 外部 URL / data URL 不改写；新增图标尚未生成副本时由捕获阶段的 error 处理器回退原图。
 */
export function resolveRuntimeProjectImage(source) {
    const normalized = normalizeSource(source);
    if (!normalized.startsWith('assets/')) return normalized;
    if (normalized.startsWith(RUNTIME_ICON_ROOT)) return normalized;
    return `${RUNTIME_ICON_ROOT}${normalized.slice('assets/'.length)}`;
}

function ensureFallbackHandler() {
    if (fallbackHandlerInstalled || typeof document === 'undefined') return;
    fallbackHandlerInstalled = true;
    document.addEventListener('error', (event) => {
        const image = event.target;
        if (image?.tagName !== 'IMG' || image.dataset.projectImage !== 'true') return;
        const original = image.dataset.projectOriginalSrc;
        if (!original || image.dataset.projectFallbackUsed === 'true') return;
        image.dataset.projectFallbackUsed = 'true';
        image.src = original;
    }, true);
}

/** 生成统一的项目图标 DOM；用于建筑升级卡和武器改造选项。 */
export function renderLightweightProjectImage(source, {
    className = '',
    alt = '',
    ariaHidden = true,
    draggable = false,
} = {}) {
    const original = normalizeSource(source);
    if (!original) return '';
    ensureFallbackHandler();
    const runtime = resolveRuntimeProjectImage(original);
    const classAttr = className ? ` class="${escapeAttribute(className)}"` : '';
    const ariaAttr = ariaHidden ? ' aria-hidden="true"' : '';
    return `<img${classAttr} src="${escapeAttribute(runtime)}" alt="${escapeAttribute(alt)}"`
        + `${ariaAttr} draggable="${draggable ? 'true' : 'false'}"`
        + ' loading="lazy" decoding="async" fetchpriority="low"'
        + ' data-project-image="true"'
        + ` data-project-runtime-src="${escapeAttribute(runtime)}"`
        + ` data-project-original-src="${escapeAttribute(original)}">`;
}

/**
 * 面板关闭时移除项目图片节点，让浏览器可回收对应解码表面。
 * 原始 HTTP 缓存仍由浏览器管理；再次打开面板会由正式渲染链重新创建节点。
 */
export function releaseLightweightProjectImages(root) {
    if (!root?.querySelectorAll) return 0;
    const images = [...root.querySelectorAll(PROJECT_IMAGE_SELECTOR)];
    for (const image of images) {
        image.removeAttribute('src');
        image.removeAttribute('srcset');
        image.remove();
    }
    return images.length;
}
