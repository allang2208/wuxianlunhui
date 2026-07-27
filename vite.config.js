import fs from 'node:fs';
import path from 'node:path';

// 开发服务器直存 JSON：编辑器类数据（墙壁预制库等）保存时直接写入
// public/<rel>（运行时 fetch 读取）与 <rel>（data/ 源目录，双份同步），免手动复制。
// 仅限 data/ 前缀，防路径穿越。生产环境由 Electron save-json IPC 承担。
const saveJsonPlugin = {
  name: 'dev-save-json',
  configureServer(server) {
    server.middlewares.use('/__save-json', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const { rel, data } = JSON.parse(body);
          if (typeof rel !== 'string' || !rel.startsWith('data/') || rel.includes('..') || !rel.endsWith('.json')) {
            throw new Error('invalid rel: ' + rel);
          }
          const content = JSON.stringify(data, null, 2);
          for (const target of [path.join('public', rel), rel]) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content, 'utf8');
          }
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.statusCode = 400;
          res.end(String(err));
        }
      });
    });

    // 逐帧武器数据导出：开发面板💾保存时覆盖写固定文件 weapon-frames/latest.js
    // （路径固定、无参数，无路径穿越面；生产环境由 Electron save-weapon-frames IPC 承担）
    server.middlewares.use('/__save-weapon-frames', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const content = '// 逐帧武器数据导出（开发面板💾保存时自动覆盖此文件）\n'
            + '// 合并方式：把 frames 数组合并进 public/data/weapon-anim-config.json 对应武器的 attack.frames（该配置仅此单份）\n'
            + 'export default ' + JSON.stringify(payload, null, 2) + '\n';
          const target = path.join('weapon-frames', 'latest.js');
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, content, 'utf8');
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.statusCode = 400;
          res.end(String(err));
        }
      });
    });
  }
};

export default {
  base: './',
  plugins: [saveJsonPlugin],
  build: {
    chunkSizeWarningLimit: 2500
  },
  server: {
    watch: {
      ignored: ['**/node_modules/**', '**/.git/**', '**/AppData/**', '**/Cookies-journal', '**/*.log']
    }
  }
}
