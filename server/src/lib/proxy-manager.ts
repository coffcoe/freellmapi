// FreeLLMAPI Smart Proxy Manager
// 智能代理管理系统
// 支持混合模式（HTTP + SOCKS5）
// 按提供商差异化代理策略
// 自动降级到直连提供商
//
// ⚠️ 关键改动：不再使用全局环境变量控制代理
// 而是提供 getProxyAgent() 函数，在运行时按平台动态决定是否使用代理

import type { HttpProxyAgent } from 'http-proxy-agent';

export interface ProxyProviderConfig {
  needsProxy: boolean;
  proxyType?: 'http' | 'socks5';
  fallbackPriority?: number;
  timeoutMs?: number;
  direct?: boolean;
}

export interface ProxyConfig {
  enabled: boolean;
  httpProxy: string;
  socks5Proxy: string;
  timeout: number;
  healthCheckInterval: number;
  fallbackTimeout: number;
  providers: Record<string, ProxyProviderConfig>;
  fallback: {
    autoSwitchToDirect: boolean;
    directProviders: string[];
    maxRetries: number;
    notificationMessage: string;
  };
  proxyHealth: {
    status: 'healthy' | 'unhealthy' | 'unknown';
    lastChecked: Date | null;
    consecutiveFailures: number;
  };
}

// 代理配置常量
export const PROXY_CONFIG: ProxyConfig = {
  // 代理总开关
  enabled: process.env.PROXY_ENABLED === 'true',
  
  // HTTP 代理端口
  httpProxy: process.env.HTTP_PROXY || 'http://127.0.0.1:10808',
  
  // SOCKS5 代理端口
  socks5Proxy: process.env.SOCKS5_PROXY || 'socks5://127.0.0.1:1080',
  
  // 代理超时（毫秒）
  timeout: parseInt(process.env.PROXY_TIMEOUT || '5000'),
  
  // 健康检测间隔（毫秒）
  healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000'),
  
  // 降级超时（毫秒）
  fallbackTimeout: parseInt(process.env.FALLBACK_TIMEOUT || '3000'),
  
  // 按提供商配置（差异化代理策略）
  providers: {
    // === 需要代理的国际提供商 ===
    openrouter:     { needsProxy: true, proxyType: 'http', fallbackPriority: 1, timeoutMs: 30000 },
    nvidia:         { needsProxy: true, proxyType: 'http', fallbackPriority: 2, timeoutMs: 30000 },
    google:         { needsProxy: true, proxyType: 'http', fallbackPriority: 3, timeoutMs: 30000 },
    github:         { needsProxy: true, proxyType: 'http', fallbackPriority: 4, timeoutMs: 30000 },
    huggingface:    { needsProxy: true, proxyType: 'http', fallbackPriority: 5, timeoutMs: 30000 },
    cloudflare:     { needsProxy: true, proxyType: 'http', fallbackPriority: 6, timeoutMs: 15000 },
    mistral:        { needsProxy: true, proxyType: 'http', fallbackPriority: 7, timeoutMs: 15000 },
    groq:           { needsProxy: true, proxyType: 'http', fallbackPriority: 8, timeoutMs: 15000 },
    ollama:         { needsProxy: true, proxyType: 'http', fallbackPriority: 9, timeoutMs: 120000 },
    kilo:           { needsProxy: true, proxyType: 'http', fallbackPriority: 10, timeoutMs: 15000 },
    llm7:           { needsProxy: true, proxyType: 'http', fallbackPriority: 11, timeoutMs: 15000 },
    cerebras:       { needsProxy: true, proxyType: 'http', fallbackPriority: 12, timeoutMs: 15000 },
    sambanova:      { needsProxy: true, proxyType: 'http', fallbackPriority: 13, timeoutMs: 15000 },
    cohere:         { needsProxy: true, proxyType: 'http', fallbackPriority: 14, timeoutMs: 15000 },
    pollinations:   { needsProxy: true, proxyType: 'http', fallbackPriority: 15, timeoutMs: 15000 },
    opencode:       { needsProxy: true, proxyType: 'http', fallbackPriority: 16, timeoutMs: 15000 },
    
    // === 中国直连无需代理的提供商 ===
    zhipu:          { needsProxy: false, direct: true },
    xunfei:         { needsProxy: false, direct: true },
    modelscope:     { needsProxy: false, direct: true },
    siliconflow:    { needsProxy: false, direct: true },
    deepseek:       { needsProxy: false, direct: true },
    ali_bailian:    { needsProxy: false, direct: true },
    SenseNova:      { needsProxy: false, direct: true },
    
    // === WorkBuddy 自定义模型 —— 始终直连，不走代理 ===
    custom:         { needsProxy: false, direct: true },
  },
  
  // 降级策略
  fallback: {
    autoSwitchToDirect: true,
    directProviders: ['zhipu', 'xunfei', 'modelscope', 'siliconflow', 'deepseek', 'ali_bailian', 'SenseNova', 'custom'],
    maxRetries: 2,
    notificationMessage: '代理不可用，已自动切换到直连提供商',
  },
  
  // 代理健康状态
  proxyHealth: {
    status: 'unknown',
    lastChecked: null,
    consecutiveFailures: 0,
  },
};

// ========================
// 核心功能：按平台获取代理信息
// ========================

/**
 * 判断某个平台是否需要代理
 */
export function needsProxy(platform: string): boolean {
  const config = PROXY_CONFIG.providers[platform];
  if (!config) {
    // 未知平台，默认不走代理（保守策略）
    return false;
  }
  return config.needsProxy && PROXY_CONFIG.enabled;
}

/**
 * 获取指定平台的代理 URL，不需要代理的平台返回 null
 */
export function getProxyUrlForPlatform(platform: string): string | null {
  if (!needsProxy(platform)) {
    return null;
  }
  const config = PROXY_CONFIG.providers[platform];
  if (!config) return null;
  
  if (config.proxyType === 'socks5') {
    return PROXY_CONFIG.socks5Proxy;
  }
  return PROXY_CONFIG.httpProxy;
}

/**
 * 获取动态代理 Agent
 * 
 * @returns Agent 实例（如果需要代理）或 null（如果直连）
 * 
 * ⚠️ 不在模块加载时 import http-proxy-agent，而是在运行时按需 import
 * 这样可以避免在没有代理需求的情况下引入额外依赖
 */
export async function getProxyAgent(platform: string): Promise<any> {
  const proxyUrl = getProxyUrlForPlatform(platform);
  if (!proxyUrl) {
    return null; // 直连，不需要代理
  }

  try {
    const { HttpProxyAgent } = await import('http-proxy-agent');
    return new HttpProxyAgent(proxyUrl);
  } catch (err) {
    console.warn(`[ProxyManager] Failed to load http-proxy-agent for platform=${platform}:`, err);
    return null;
  }
}

// ========================
// 其他工具函数
// ========================

/** 获取提供商的代理配置 */
export function getProxyConfigForProvider(platform: string): ProxyProviderConfig | null {
  const config = PROXY_CONFIG.providers[platform];
  return config || null;
}

/** 重置代理健康状态 */
export function resetProxyHealth() {
  PROXY_CONFIG.proxyHealth = {
    status: 'healthy',
    lastChecked: new Date(),
    consecutiveFailures: 0,
  };
}

/** 记录代理失败 */
export function recordProxyFailure() {
  PROXY_CONFIG.proxyHealth.consecutiveFailures++;
  if (PROXY_CONFIG.proxyHealth.consecutiveFailures >= 3) {
    PROXY_CONFIG.proxyHealth.status = 'unhealthy';
  }
}

/** 记录代理成功 */
export function recordProxySuccess() {
  PROXY_CONFIG.proxyHealth.consecutiveFailures = 0;
  PROXY_CONFIG.proxyHealth.status = 'healthy';
  PROXY_CONFIG.proxyHealth.lastChecked = new Date();
}

/** 检查代理健康状态 */
export function isProxyHealthy(): boolean {
  return PROXY_CONFIG.proxyHealth.status === 'healthy';
}
