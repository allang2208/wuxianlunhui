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
