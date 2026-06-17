// check-opencode-quota.js
// 定期检查 OpenCode API Key 是否过期，如果过期则自动禁用
const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'server', 'data', 'freeapi.db');
const ENV_PATH = path.join(__dirname, '.env');

// 加载加密密钥
const envContent = fs.readFileSync(ENV_PATH, 'utf8');
const keyMatch = envContent.match(/ENCRYPTION_KEY=(.+)/);
const encryptionKey = Buffer.from(keyMatch[1], 'hex');

const db = sqlite3(DB_PATH);

// 检查 OpenCode Key 是否还在数据库中标记为有效
const key = db.prepare("SELECT id, label, status, enabled, created_at FROM api_keys WHERE platform = 'opencode'").get();

if (!key) {
    console.log('[OpenCode] 未找到 OpenCode API Key');
    process.exit(0);
}

console.log(`[OpenCode] 当前状态:`);
console.log(`  ID: ${key.id}`);
console.log(`  Label: ${key.label}`);
console.log(`  Status: ${key.status}`);
console.log(`  Enabled: ${key.enabled}`);
console.log(`  Created: ${key.created_at}`);

// 检查 label 中是否包含过期日期
const expiryMatch = key.label.match(/exp:\s*(\d{4}-\d{2}-\d{2})/);
if (expiryMatch) {
    const expiryDate = new Date(expiryMatch[1]);
    const today = new Date();
    const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

    console.log(`  预计过期: ${expiryMatch[1]} (${daysUntilExpiry > 0 ? daysUntilExpiry + ' 天后' : daysUntilExpiry === 0 ? '今天' : '已过期'})`);

    if (daysUntilExpiry < 0) {
        console.log(`[警告] OpenCode Key 已过期！自动禁用...`);
        db.prepare("UPDATE api_keys SET enabled = 0, status = 'expired' WHERE id = ?").run(key.id);
        console.log(`[操作] 已禁用该 Key (id: ${key.id})`);
    } else if (daysUntilExpiry <= 7) {
        console.log(`[提醒] OpenCode Key 即将在 ${daysUntilExpiry} 天后过期，请尽快更换！`);
    } else {
        console.log(`[OK] OpenCode Key 仍然有效`);
    }
} else {
    console.log(`[Info] 未检测到过期日期标记`);
}

// 检查 API 健康状态
if (key.status === 'unhealthy' || key.status === 'error') {
    console.log(`[警告] OpenCode API 状态异常: ${key.status}`);
    console.log(`[建议] 检查 API Key 是否有效或额度是否耗尽`);
}

db.close();
