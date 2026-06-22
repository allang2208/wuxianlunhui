import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  // 基础路径（Electron 中加载本地文件，使用相对路径）
  base: './',
  // 构建配置
  build: {
    // 输出目录
    outDir: 'dist',
    // 清空输出目录
    emptyOutDir: true,
    // 资源内联阈值
    assetsInlineLimit: 4096,
    // 静态资源处理
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        entryFileNames: 'js/[name]-[hash].js',
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name || '';
          if (info.endsWith('.css')) {
            return 'css/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  // 开发服务器
  server: {
    port: 5173,
    host: true,
  },
  // 解析路径别名
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  // 不设置 publicDir，assets 目录通过 electron-builder 直接打包
  // 代码中引用的 'assets/...' 路径在生产环境中保持不变
});

