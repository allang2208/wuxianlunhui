// 手动发布的固定测试通道。仅发布包中的 testRelease 元数据启用，不读开发目录。
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function configureFixedTest({ app, protocol, net }) {
    const release = app.isPackaged ? require('../package.json').testRelease : null;
    if (!release) return null;

    // 版本目录会变化，测试通道的数据目录和页面 origin 必须保持不变。
    // 不搬移、不覆盖开发版或历史 EXE 的用户数据。
    const profile = path.join(app.getPath('appData'), 'wuxian-lunhui-fixed-test');
    fs.mkdirSync(profile, { recursive: true });
    app.setPath('userData', profile);
    app.setPath('sessionData', profile);
    protocol.registerSchemesAsPrivileged([{
        scheme: 'wl-test',
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    }]);

    const canRun = app.requestSingleInstanceLock();
    if (!canRun) app.quit();

    return {
        release,
        canRun,
        url: 'wl-test://game/index.html',
        registerProtocol() {
            const dist = path.resolve(__dirname, '../dist');
            protocol.handle('wl-test', (request) => {
                const url = new URL(request.url);
                if (url.hostname !== 'game' || !['GET', 'HEAD'].includes(request.method)) {
                    return new Response('Forbidden', { status: 403 });
                }
                let target;
                try {
                    target = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
                } catch {
                    return new Response('Bad request', { status: 400 });
                }
                const relative = path.relative(dist, target);
                if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
                    return new Response('Forbidden', { status: 403 });
                }
                // 带时间戳的 JSON 和绝对 /assets/ 路径也只从本版 dist 读取。
                return net.fetch(pathToFileURL(target).href, { method: request.method });
            });
        }
    };
}

module.exports = { configureFixedTest };
