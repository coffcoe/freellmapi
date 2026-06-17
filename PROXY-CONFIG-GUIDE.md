# FreeLLMAPI 智能代理配置

## 1. 代理配置（.env 文件）

在 `C:/Users/coffcoe/freellmapi/.env` 文件中添加以下代理配置：

```env
# 代理配置
HTTP_PROXY=http://127.0.0.1:10808
HTTPS_PROXY=http://127.0.0.1:10808
ALL_PROXY=socks5://127.0.0.1:1080

# 代理开关
PROXY_ENABLED=true

# 代理超时（毫秒）
PROXY_TIMEOUT=5000

# 健康检测间隔（毫秒）
HEALTH_CHECK_INTERVAL=60000

# NO_PROXY：直连地址（排除代理）
NO_PROXY=localhost,127.0.0.1,192.168.*,100.66.*,*.local,.internal

# 降级配置
FALLBACK_TIMEOUT=3000
AUTO_FALLBACK_TO_DIRECT=true
DIRECT_PROVIDERS=zhipu,xunfei,modelscope,siliconflow,deepseek,ali_bailian,SenseNova
```

## 2. 智能代理路由策略

### 按提供商差异化配置

**需要代理的国际提供商**：
- openrouter, nvidia, google, github, huggingface, cloudflare
- mistral, groq, ollama, kilo, llm7, cerebras, sambanova, cohere
- pollinations, opencode

**中国直连无需代理的提供商**：
- zhipu（智谱）
- xunfei（讯飞）
- modelscope（魔搭）
- siliconflow（硅基流动）
- deepseek（深度求索）
- ali_bailian（阿里百炼）
- SenseNova（商汤科技）

## 3. 自动降级机制

1. 代理可用时：按策略路由
2. 代理超时时：自动降级到直连提供商
3. 代理健康检测：每 60 秒检查一次
4. 连续失败 3 次：标记为 unhealthy

## 4. 实施步骤

### 第一步：更新 .env 文件
添加上述代理配置到 `C:/Users/coffcoe/freellmapi/.env`

### 第二步：重启 FreeLLMAPI 服务
```powershell
# 停止服务
net stop freellmapi

# 启动服务
net start freellmapi
# 或者
& "C:/Users/coffcoe/.workbuddy/binaries/node/versions/22.22.2/node.exe" C:/Users/coffcoe/freellmapi/server/dist/index.js
```

### 第三步：验证代理配置
```bash
# 测试国内直连
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer freellmapi-2cdec9618331a9432a956c6174375c001a0b0f28d695f72e" \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-4-flash","messages":[{"role":"user","content":"test"}],"max_tokens":10}'

# 测试国际提供商
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer freellmapi-2cdec9618331a9432a956c6174375c001a0b0f28d695f72e" \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/gpt-oss-20b:free","messages":[{"role":"user","content":"test"}],"max_tokens":10}'
```
