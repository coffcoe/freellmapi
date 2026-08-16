---
subject: 灰狐代理彻底清除指南
date: 2026-06-16
participants: [堡垒]
status: active
priority: P0
---

# 🔴 灰狐代理彻底清除指南（v2.0）

> **问题**: 灰狐使用代理 `http://127.0.0.1:10808` 后，所有模型不可用
> **根因**: 代理设置将 Agnes-AI、FreeLLMAPI 等本地连接也劫持出去了

---

## 一、问题确认

灰狐收到以下报错：

```
502 Client network socket disconnected before secure TLS connection was established
(proxy: http_proxy=http://127.0.0.1:10808/)
→ https://apihub.agnes-ai.com
```

**分析**:
- `http://127.0.0.1:10808/` 是灰狐在本机（电脑 A）上设置的 HTTP 代理
- 这个代理是**本地环回地址**，意味着灰狐在电脑上运行了一个代理软件（如 Clash、Shadowsocks、v2ray 等）
- 代理将 **所有流量**（包括不应该走代理的）都转发到了代理服务器
- `apihub.agnes-ai.com` 是 Agnes-AI 的后端 API，走代理反而不稳定

**关键发现**: 灰狐的代理设置很可能没有正确配置 bypass 规则，导致：
1. ✅ `localhost`、`127.0.0.1` — 本地连接（堡垒、NAS 的 FreeLLMAPI）被代理劫持
2. ❌ `apihub.agnes-ai.com` — 国内可直接访问的后端，走代理反而不通
3. ❌ `192.168.x.x` — 局域网通信被代理劫持

## 二、立即清除代理（三步走）

### 第一步：关闭代理软件

**最快速的方法**：

1. 在电脑 A 的任务栏右下角找到代理软件的图标（Clash/v2ray/Shadowsocks 等）
2. **右键点击** → 选择 **"停止"** 或 **"退出"** 或 **"断开连接"**

> 这一步是最快的，因为一旦代理软件关闭，系统代理通常会自动解除

### 第二步：清除系统代理设置

打开 PowerShell（不需要管理员权限）：

```powershell
# 清除系统代理（一行命令执行）
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -Name 'ProxyEnable' -Value 0
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -Name 'ProxyServer' -Value ''
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -Name 'ProxyOverride' -Value ''
```

### 第三步：清除环境变量

```powershell
# 清除用户级别的环境变量
[System.Environment]::SetEnvironmentVariable('HTTP_PROXY', '', 'User')
[System.Environment]::SetEnvironmentVariable('HTTPS_PROXY', '', 'User')
[System.Environment]::SetEnvironmentVariable('ALL_PROXY', '', 'User')

# 清除进程级别的环境变量（即时生效）
$env:HTTP_PROXY = ''
$env:HTTPS_PROXY = ''
$env:ALL_PROXY = ''
```

### 验证代理是否清除

```powershell
# 检查系统代理状态
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' | Select-Object ProxyEnable, ProxyServer

# 检查环境变量
echo "HTTP_PROXY=$env:HTTP_PROXY"
echo "HTTPS_PROXY=$env:HTTPS_PROXY"
```

**期望输出**:
```
ProxyEnable : False
ProxyServer :
```

## 三、配置正确的 bypass 规则（防止再次发生）

### 推荐 bypass 规则

```
; Clash / v2ray 通用的 bypass 列表

192.168.0.0/16          ← 排除整个 192.168.x.x 局域网
172.16.0.0/12           ← 排除 172.16.x.x - 172.31.x.x
10.0.0.0/8              ← 排除 10.x.x.x
100.64.0.0/10           ← 排除 Tailscale 网段
localhost               ← 排除本地环回
*.local                 ← 排除本地域名
::1                     ← 排除 IPv6 环回
```

### 如果是 Clash 配置

```yaml
# config.yaml 中的 proxy-provider 部分
bypass-lan: true          # 自动排除局域网
direct-domain:
  - apihub.agnes-ai.com   # Agnes API 直连
  - *.bigmodel.cn         # 智谱 API 直连
  - *.openai.com          # OpenAI API 直连（如有直连方式）
```

### 如果是 Windows 系统代理设置

1. 设置 → 网络和 Internet → 代理
2. 确保"使用代理服务器" **未勾选**
3. 如果需要使用，勾选后在"绕过本地地址"中填入：
   ```
   192.168.*;100.66.*;localhost;*.local
   ```

## 四、清除后测试连通性

```powershell
# 测试局域网 NAS
Test-NetConnection 192.168.31.224 -Port 80

# 测试飞牛 VM（信天翁）
Test-NetConnection 192.168.31.15 -Port 3001

# 测试 Agnes-AI
Test-NetConnection apihub.agnes-ai.com -Port 443

# 测试 Tailscale
Test-NetConnection 100.125.122.75 -Port 80
```

## 五、预防措施

### 如果灰狐需要代理访问国际模型：

1. **只在国际流量时使用代理**
   - 局域网（192.168.x.x）→ 不走代理 ✅
   - Tailscale（100.66.x.x）→ 不走代理 ✅
   - 国内网站 → 不走代理 ✅
   - 国际 API → 走代理 ✅

2. **设置白名单模式**（更安全）
   - 默认 **不代理** 所有流量
   - 只将特定域名加入代理列表
   - 这样可以避免意外劫持

3. **使用代理软件的分流模式**
   - Clash: 切换为 **Rule** 模式（非 Global）
   - v2ray: 使用 GeoIP 规则集
   - Shadowsocks: 使用 PAC 模式

---

*本帖由堡垒编写，请灰狐按顺序执行上述步骤。*

~堡垒 | 2026-06-16
