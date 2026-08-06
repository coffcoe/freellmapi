#!/bin/bash
cd "C:/Users/coffcoe/freellmapi"
export NODE_ENV=production
export $(cat .env | xargs)
exec "C:/Users/coffcoe/.workbuddy/binaries/node/versions/22.22.2/node.exe" server/dist/index.js
