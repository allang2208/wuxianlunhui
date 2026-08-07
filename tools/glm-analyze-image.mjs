#!/usr/bin/env node
/* 用智谱 GLM-4.6V 分析本地图片（绕过 deepseek-vision-skill 的 provider 白名单） */
import fs from 'node:fs';
import path from 'node:path';

const CONFIG = JSON.parse(fs.readFileSync('C:/Users/allan/.codex/skills/deepseek-vision-skill/config.json', 'utf8'));
const ENDPOINT = CONFIG.endpoint || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const MODEL = CONFIG.model || 'glm-4.6v';
const prompt = process.argv[2] || '请详细描述这张图片的内容。';
const paths = process.argv.slice(3);

const content = [
    { type: 'text', text: prompt },
    ...paths.map((p) => {
        const b64 = fs.readFileSync(path.resolve(p)).toString('base64');
        return { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } };
    }),
];

const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.api_key}`,
    },
    body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content }],
        max_tokens: CONFIG.max_tokens || 3000,
    }),
});
const j = await res.json();
if (j.error) {
    console.error('API error:', JSON.stringify(j.error));
    process.exit(1);
}
console.log(j.choices?.[0]?.message?.content ?? JSON.stringify(j).slice(0, 1000));
