// 只启动已经发布好的 EXE，绝不自动构建或退回 Vite。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

try {
    const releases = path.resolve(__dirname, '../.exe-releases');
    const pointer = path.join(releases, 'latest.json');
    if (!fs.existsSync(pointer)) throw new Error('尚未发布固定测试版。请先运行“更新EXE测试版.cmd”。');
    const release = JSON.parse(fs.readFileSync(pointer, 'utf8'));
    const exe = path.resolve(releases, release.exe);
    const relative = path.relative(releases, exe);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || path.extname(exe) !== '.exe') {
        throw new Error('测试版入口不在 .exe-releases 内。');
    }
    if (!fs.existsSync(exe)) throw new Error('已发布的 EXE 不存在，请重新发布测试版。');
    const env = { ...process.env, NODE_ENV: 'production' };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(exe, [], { cwd: path.dirname(exe), env, detached: true, stdio: 'ignore' });
    child.once('error', err => {
        console.error('[测试版] 启动失败：', err.message);
        process.exitCode = 1;
    });
    child.once('spawn', () => {
        console.log(`[测试版] ${release.id}；若已有旧版窗口，将继续该窗口，退出后再启动才进入新版。`);
        child.unref();
    });
} catch (err) {
    console.error('[测试版]', err.message);
    process.exitCode = 1;
}
