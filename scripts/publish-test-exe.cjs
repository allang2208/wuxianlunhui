// 仅用户明确要求同步 EXE 时运行。不会刷新、停止或覆盖任何已发布版本。
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const releases = path.join(root, '.exe-releases');

function copySnapshotEntry(name, destination, required = true) {
    const source = path.join(root, name);
    if (!fs.existsSync(source) && !required) return;
    // 实际复制字节，不用硬链接或目录联接；不把活动资产映射进测试包。
    fs.cpSync(source, path.join(destination, name), {
        recursive: true,
        dereference: true,
        force: false,
        errorOnExist: true
    });
}

async function main() {
    if (process.platform !== 'win32') throw new Error('请在 Windows 上发布 EXE 测试版。');
    fs.mkdirSync(releases, { recursive: true });
    const lockPath = path.join(releases, 'publishing.lock');
    let lock;
    try {
        lock = fs.openSync(lockPath, 'wx');
    } catch (err) {
        if (err.code === 'EEXIST') {
            throw new Error('已有发布任务或上次中断留下 publishing.lock；确认没有发布任务后再移除该锁文件。');
        }
        throw err;
    }

    try {
        const now = new Date();
        const stamp = [now.getFullYear(), ...[now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
            .map(value => String(value).padStart(2, '0'))].join('');
        const id = `${stamp}-${randomUUID().slice(0, 8)}`;
        const releaseDir = path.join(releases, id);
        const snapshot = path.join(releaseDir, 'source');
        fs.mkdirSync(snapshot, { recursive: true });
        fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, id, createdAt: now.toISOString() }));

        console.log('[测试版] 复制当前工作区快照（包含未提交改动）。复制完成前请勿继续编辑待发布功能。');
        for (const name of ['src', 'data', 'public', 'assets', 'ui', 'electron', 'index.html', 'game-style.css', 'vite.config.js', 'package.json']) {
            copySnapshotEntry(name, snapshot);
        }
        copySnapshotEntry('build', snapshot, false);
        copySnapshotEntry('package-lock.json', snapshot, false);
        console.log('[测试版] 快照复制完成，后续构建只读取该副本的游戏代码和资源。');

        const pkgPath = path.join(snapshot, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        let sourceCommit = null;
        try {
            sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
        } catch { /* 非 Git 目录也允许本地发布，版本目录 ID 仍唯一。 */ }
        const release = { id, version: pkg.version, createdAt: now.toISOString(), sourceCommit, source: 'working-tree-snapshot' };
        fs.writeFileSync(path.join(releaseDir, 'release.json'), JSON.stringify(release, null, 2) + '\n');

        // 不调用 npm build：不改源版本号、不执行备份清理、不写共享 dist。
        process.env.NODE_ENV = 'production';
        process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
        const { build: buildWeb } = await import('vite');
        await buildWeb({
            root: snapshot,
            configFile: path.join(snapshot, 'vite.config.js'),
            build: { outDir: path.join(snapshot, 'dist'), emptyOutDir: true }
        });
        fs.cpSync(path.join(snapshot, 'assets'), path.join(snapshot, 'dist', 'assets'), { recursive: true, dereference: true });

        // Vite 已将游戏依赖打入网页；EXE 主进程只使用 Node/Electron 内置模块。
        // 包里不带源码、node_modules、开发服务器或第二份 assets。
        const appSource = path.join(releaseDir, 'package');
        fs.mkdirSync(appSource);
        fs.cpSync(path.join(snapshot, 'electron'), path.join(appSource, 'electron'), { recursive: true });
        fs.cpSync(path.join(snapshot, 'dist'), path.join(appSource, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(appSource, 'package.json'), JSON.stringify({
            name: 'wuxian-lunhui-fixed-test',
            version: pkg.version,
            description: pkg.description,
            author: pkg.author,
            license: pkg.license,
            main: 'electron/main.js',
            testRelease: release
        }, null, 2) + '\n');

        const { build: buildExe, Platform, Arch } = require('electron-builder');
        const icon = path.join(snapshot, 'build', 'app-icon.png');
        await buildExe({
            projectDir: appSource,
            targets: Platform.WINDOWS.createTarget('dir', Arch.x64),
            publish: 'never',
            config: {
                extends: null,
                appId: 'com.wuxianlunhui.fixed-test',
                productName: '无限轮回固定测试版',
                executableName: 'wuxian-lunhui-test',
                directories: { output: path.join(releaseDir, 'app'), buildResources: path.join(snapshot, 'build') },
                files: ['dist/**/*', 'electron/**/*', 'package.json'],
                asar: true,
                npmRebuild: false,
                nodeGypRebuild: false,
                electronVersion: require('electron/package.json').version,
                electronDist: path.dirname(require('electron')),
                win: { signAndEditExecutable: false, ...(fs.existsSync(icon) ? { icon } : {}) }
            }
        });
        const exeRelative = path.join(id, 'app', 'win-unpacked', 'wuxian-lunhui-test.exe');
        if (!fs.existsSync(path.join(releases, exeRelative))) throw new Error('未生成预期的 EXE；保留原测试版入口。');

        // 发布完成后才更新启动指针；运行中的旧进程没有读取或监听这个文件。
        const pending = path.join(releases, `latest-${id}.tmp`);
        fs.writeFileSync(pending, JSON.stringify({ ...release, exe: exeRelative }, null, 2) + '\n');
        fs.renameSync(pending, path.join(releases, 'latest.json'));
        console.log(`[测试版] 已发布 ${id}\n${path.join(releases, exeRelative)}\n退出旧测试版后，双击“启动EXE测试版.cmd”进入新版。旧版本未修改。`);
    } finally {
        fs.closeSync(lock);
        fs.unlinkSync(lockPath);
    }
}

main().catch(err => {
    console.error('[测试版] 发布失败，原测试版入口保持不变。', err.message);
    process.exitCode = 1;
});
