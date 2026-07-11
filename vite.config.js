export default {
  base: './',
  build: {
    chunkSizeWarningLimit: 2500
  },
  server: {
    watch: {
      ignored: ['**/node_modules/**', '**/.git/**', '**/AppData/**', '**/Cookies-journal', '**/*.log']
    }
  }
}
