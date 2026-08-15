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
    // 同时直接合并进 public/data/weapon-anim-config.json（免助手中转，写前滚动备份）
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
          const content = '// 逐帧武器数据导出（开发面板💾保存时自动覆盖此文件，仅作记录/回滚参考）\n'
            + '// 保存时已自动合并进 public/data/weapon-anim-config.json，无需手动合并\n'
            + 'export default ' + JSON.stringify(payload, null, 2) + '\n';
          const target = path.join('weapon-frames', 'latest.js');
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, content, 'utf8');

          // 直接合并进 weapon-anim-config.json（该配置仅此单份）：
          // 保留块内其他字段（trail 等），仅替换 type/frames；写前滚动备份一份；
          // anim=attack2 时写入 attack2 块（二段连段独立轨迹）
          // anim 分块：attack / attack2 / dash / walkFrames（连段二段/冲刺攻击/行走逐帧独立轨迹，白名单防注入）
          let merged = false;
          const wt = payload.weaponType;
          const blockKey = ['attack', 'attack2', 'dash', 'walkFrames'].includes(payload.anim) ? payload.anim : 'attack';
          if (typeof wt === 'string' && Array.isArray(payload.frames) && !['__proto__', 'constructor', 'prototype'].includes(wt)) {
            const cfgPath = path.join('public', 'data', 'weapon-anim-config.json');
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            if (!cfg[wt]) cfg[wt] = {};
            cfg[wt][blockKey] = { ...(cfg[wt][blockKey] || {}), type: 'perFrame', frames: payload.frames };
            fs.copyFileSync(cfgPath, path.join('weapon-frames', 'weapon-anim-config.backup.json'));
            fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
            merged = true;
          }
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ success: true, merged }));
        } catch (err) {
          res.statusCode = 400;
          res.end(String(err));
        }
      });
    });

    // 全量武器配置保存（传统 holdOffset 模式落盘）：与 Electron save-weapon-config 同路径，
    // 纯浏览器 dev 模式下开发面板💾保存不丢（此前只复制剪贴板，刷新即丢失）
    server.middlewares.use('/__save-weapon-config', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const { config } = JSON.parse(body);
          if (!config || typeof config !== 'object') throw new Error('invalid config');
          const cfgPath = path.join('public', 'data', 'weapon-anim-config.json');
          fs.copyFileSync(cfgPath, path.join('weapon-frames', 'weapon-anim-config.backup.json'));
          fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
          fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8');
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
      ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/AppData/**',
          '**/Cookies-journal',
          '**/*.log',
          '**/.cdp-profile/**',
          '**/tools/.cdp-profile/**',
          '**/.*/**',
          '**/*.tmp',
          '**/Thumbs.db',
          '**/desktop.ini'
        ]
    }
  }
}
