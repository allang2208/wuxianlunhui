@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 此操作仅生成新的固定测试版，不刷新或关闭正在运行的旧版。
echo 请先确认整个功能已开发完成，复制快照期间不要继续修改源文件。
node scripts\publish-test-exe.cjs
pause
