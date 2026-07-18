// Node ESM 定制钩子注册：为无属性的 .json 导入补 type: json（源码按 Vite 约定裸导入 JSON）
import { register } from 'node:module';

register('./json-hooks.mjs', import.meta.url);
