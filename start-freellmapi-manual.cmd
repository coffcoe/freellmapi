@echo off
cd /d D:\Users\Yin\freellmapi
start "" /min cmd /c "C:\Users\coffcoe\.workbuddy\binaries\node\versions\22.22.2\node.exe server/dist/index.js > D:\Users\Yin\freellmapi\server\logs\freellmapi-manual.out.log 2>&1"
