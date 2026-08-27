#!/usr/bin/env node
// Read-only CDP inspection of recent Doubao chat blocks for recovery.

const port = Number(process.argv[2] || 9333);
const clickLatest = process.argv.includes('--click-latest');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl && /doubao/i.test(`${item.title} ${item.url}`));
if (!target) throw new Error('Doubao page target not found');

const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const waiter = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result || {});
});
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Runtime.enable');
await send('Runtime.evaluate', {
  expression: `document.querySelector('#to-bottom-button')?.click() || false`,
  returnByValue: true,
});
await new Promise(resolve => setTimeout(resolve, 1500));
if (clickLatest) {
  await send('Runtime.evaluate', {
    expression: `(() => {
      const blocks = [...document.querySelectorAll('[data-container-type="block-v1"]')]
        .filter(el => String(el.innerText || '').includes('你的视频生成好了'));
      const block = blocks.at(-1);
      const target = block?.querySelector('img') || block?.querySelector('[class*="block-video-"]') || block;
      target?.scrollIntoView({ block: 'center' });
      target?.click();
      return !!target;
    })()`,
    returnByValue: true,
  });
  await new Promise(resolve => setTimeout(resolve, 1800));
}
const result = await send('Runtime.evaluate', {
  expression: `(() => {
    const blocks = [...document.querySelectorAll('[data-container-type="block-v1"]')];
    const recentBlocks = blocks.map((el, index) => {
      const text = String(el.innerText || '').trim();
      const rect = el.getBoundingClientRect();
      return {
        index,
        text: text.slice(0, 3200),
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        videos: [...el.querySelectorAll('video')].map(video => ({
          src: video.currentSrc || video.src || '',
          readyState: video.readyState,
          width: video.videoWidth,
          height: video.videoHeight,
        })),
        images: [...el.querySelectorAll('img')].map(img => ({ src: img.currentSrc || img.src || '', alt: img.alt || '' })).slice(-8),
      };
    }).filter(item => item.text || item.videos.length || item.images.length).slice(-16);
    const pageVideos = [...document.querySelectorAll('video')].map((video, index) => ({
      index,
      src: video.currentSrc || video.src || '',
      readyState: video.readyState,
      width: video.videoWidth,
      height: video.videoHeight,
      visible: !!(video.offsetWidth || video.offsetHeight || video.getClientRects().length),
    }));
    return { recentBlocks, pageVideos };
  })()`,
  returnByValue: true,
});
if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'page evaluation failed');
console.log(JSON.stringify({ title: target.title, url: target.url, ...(result.result?.value || {}) }, null, 2));
ws.close();
