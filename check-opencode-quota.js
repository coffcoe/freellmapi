#!/usr/bin/env node
/**
 * Check OpenCode Zen API Key quota status
 * 
 * Usage: node check-opencode-quota.js [api_key]
 * 
 * If no API key is provided, tries to read from:
 * - .env file
 * - process.env.OPENCODE_API_KEY
 * - config.env
 * 
 * Endpoints:
 * - https://opencode.ai/zen/v1/dashboard/billing/usage
 * - https://opencode.ai/zen/v1/models
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// --- Helpers ---

function fetchJSON(url, headers, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: headers,
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data, raw: true });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function readEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const env = {};
    content.split(/\n/).forEach((line) => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx > 0) {
        env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      }
    });
    return env;
  } catch {
    return null;
  }
}

function getApiKey() {
  // 1. CLI argument
  const args = process.argv.slice(2);
  if (args[0]) return args[0];

  // 2. Environment variable
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY;

  // 3. .env file in project root
  const envPath = path.join(__dirname, '.env');
  const env = readEnvFile(envPath);
  if (env && env.OPENCODE_API_KEY) return env.OPENCODE_API_KEY;

  // 4. config.env
  const configPath = path.join(__dirname, 'config.env');
  const config = readEnvFile(configPath);
  if (config && config.OPENCODE_API_KEY) return config.OPENCODE_API_KEY;

  return null;
}

// --- Main ---

async function main() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  🔑 OpenCode Zen API Key 额度检查');
  console.log('═══════════════════════════════════════════\n');

  const apiKey = getApiKey();
  
  if (!apiKey) {
    console.log('⚠️  未找到 OpenCode API Key');
    console.log('');
    console.log('请在以下位置之一配置 OPENCODE_API_KEY:');
    console.log('  1. 命令行参数: node check-opencode-quota.js <your_key>');
    console.log('  2. 环境变量: OPENCODE_API_KEY=xxx');
    console.log('  3. .env 文件: OPENCODE_API_KEY=xxx');
    console.log('  4. config.env 文件: OPENCODE_API_KEY=xxx');
    console.log('');
    console.log('获取 Key: https://opencode.ai/auth');
    return;
  }

  // 显示 masked key
  const maskedKey = apiKey.length > 12 
    ? apiKey.slice(0, 6) + '***' + apiKey.slice(-4)
    : '***';
  console.log(`📌 正在检查 Key: ${maskedKey}`);
  console.log('');

  const BASE_URL = 'https://opencode.ai/zen/v1';
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // 并行检查多个端点
  const results = {};

  // 1. 检查余额/用量
  try {
    console.log('⏳ 正在检查余额和用量...');
    const usageRes = await fetchJSON(
      `${BASE_URL}/dashboard/billing/usage`,
      headers
    );
    results.usage = { status: usageRes.status, data: usageRes.body };
    console.log(`   → HTTP ${usageRes.status}`);
  } catch (e) {
    results.usage = { error: e.message };
    console.log(`   → 错误: ${e.message}`);
  }

  // 2. 检查可用模型列表
  try {
    console.log('⏳ 正在检查可用模型...');
    const modelsRes = await fetchJSON(
      `${BASE_URL}/models`,
      headers
    );
    results.models = { status: modelsRes.status, data: modelsRes.body };
    console.log(`   → HTTP ${modelsRes.status}`);
  } catch (e) {
    results.models = { error: e.message };
    console.log(`   → 错误: ${e.message}`);
  }

  // 3. 发送一个轻量请求测试 Key 有效性
  try {
    console.log('⏳ 正在测试 Key 有效性...');
    const testRes = await fetchJSON(
      `${BASE_URL}/chat/completions`,
      {
        ...headers,
        'Content-Type': 'application/json',
      },
      'POST',
      JSON.stringify({
        model: 'big-pickle',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      })
    );
    results.test = { status: testRes.status, data: testRes.body };
    console.log(`   → HTTP ${testRes.status}`);
  } catch (e) {
    results.test = { error: e.message };
    console.log(`   → 错误: ${e.message}`);
  }

  // --- 分析结果 ---
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  📊 检查结果摘要');
  console.log('═══════════════════════════════════════════');
  console.log('');

  let overallStatus = 'unknown';
  let warnings = [];

  // 分析 Key 有效性
  if (results.test) {
    if (results.test.error) {
      overallStatus = 'error';
      console.log(`❌ Key 测试失败: ${results.test.error}`);
      console.log('');
      console.log('⚠️  建议:');
      console.log('   - 确认 Key 是否正确复制（不要有多余空格）');
      console.log('   - 前往 https://opencode.ai/auth 确认账号状态');
      console.log('   - 如果 Key 已过期，请重新获取');
    } else if (results.test.status === 401 || results.test.status === 403) {
      overallStatus = 'expired';
      console.log(`❌ Key 已失效 (HTTP ${results.test.status})`);
      console.log('');
      console.log('⚠️  建议:');
      console.log('   - Key 可能已过期或被撤销');
      console.log('   - 前往 https://opencode.ai/auth 获取新的 Key');
    } else if (results.test.status === 429) {
      overallStatus = 'rate_limited';
      console.log(`⚠️  Key 触发限流 (HTTP ${results.test.status})`);
      console.log('');
      console.log('💡 建议:');
      console.log('   - OpenCode Zen 免费模型有 RPM/RPD 限制');
      console.log('   - 等待一段时间后重试');
    } else {
      overallStatus = 'healthy';
      console.log(`✅ Key 状态正常 (HTTP ${results.test.status})`);
    }
  }

  console.log('');

  // 分析余额/用量
  if (results.usage) {
    if (results.usage.error) {
      console.log(`💰 余额信息: 无法获取 (${results.usage.error})`);
    } else if (results.usage.data) {
      const data = results.usage.data;
      if (data.error) {
        console.log(`💰 余额信息: 获取失败 - ${data.error.message || data.error}`);
      } else {
        // 解析余额数据
        const billingStatus = data.billing_status || 'unknown';
        const hardLimitUsd = data.hard_limit_usd;
        const totalGranted = data.total_granted || 0;
        const totalUsage = data.total_usage || 0;
        const totalAjusd = data.total_adjusted_usd || totalUsage;

        console.log(`💰 余额信息:`);
        console.log(`   账户状态: ${billingStatus}`);
        if (hardLimitUsd !== undefined) {
          console.log(`   月度限额: $${hardLimitUsd}`);
        }
        if (totalGranted !== undefined) {
          console.log(`   赠送额度: $${parseFloat(totalGranted).toFixed(4)}`);
        }
        if (totalUsage !== undefined || totalAjusd !== undefined) {
          console.log(`   已用额度: $${parseFloat(totalAjusd || totalUsage).toFixed(4)}`);
        }

        // 检查是否即将用完
        if (totalGranted && totalGranted > 0) {
          const usagePercent = (totalUsage / totalGranted) * 100;
          if (usagePercent > 90) {
            warnings.push(`⚠️  额度已使用 ${usagePercent.toFixed(1)}%，即将用完！`);
          } else if (usagePercent > 70) {
            warnings.push(`ℹ️  额度已使用 ${usagePercent.toFixed(1)}%，请留意余额。`);
          }
        }
      }
    }
  }

  console.log('');

  // 分析模型列表
  if (results.models) {
    if (results.models.error) {
      console.log(`📦 模型列表: 无法获取 (${results.models.error})`);
    } else if (results.models.data) {
      const models = results.models.data;
      const modelList = models.data || models;
      const count = Array.isArray(modelList) ? modelList.length : 0;
      console.log(`📦 可用模型: ${count} 个`);
      
      // 显示免费模型
      if (Array.isArray(modelList)) {
        const freeModels = modelList
          .filter(m => 
            m.id && (
              m.id.includes('free') || 
              m.id === 'big-pickle' ||
              m.id === 'mimo-v2.5-free'
            )
          )
          .map(m => m.id);
        
        if (freeModels.length > 0) {
          console.log(`   免费模型: ${freeModels.join(', ')}`);
        }
      }
    }
  }

  // 显示警告
  if (warnings.length > 0) {
    console.log('');
    warnings.forEach(w => console.log(w));
  }

  // 最终状态
  console.log('');
  console.log('═══════════════════════════════════════════');
  const statusEmoji = {
    healthy: '✅',
    rate_limited: '⚠️',
    expired: '❌',
    error: '❌',
    unknown: '❓',
  };
  console.log(`  总体状态: ${statusEmoji[overallStatus] || '❓'} ${overallStatus.toUpperCase()}`);
  console.log('═══════════════════════════════════════════');

  return overallStatus;
}

main().catch((e) => {
  console.error('检查失败:', e.message);
  process.exit(1);
});
