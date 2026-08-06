// T-SEC-2: 从 credential-vault 解密取出 ENCRYPTION_KEY 并输出到 stdout（无换行）。
// 仅当 VAULT_PASSWORD 环境变量可用且解密成功时输出；任何失败静默退出（交回 .env 兜底）。
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const vp = process.env.VAULT_PASSWORD;
if (!vp) process.exit(0);

const vaultFile = path.join(os.homedir(), '.workbuddy', 'vault', 'vault.enc');
if (!fs.existsSync(vaultFile)) process.exit(0);

try {
  const out = execFileSync(
    'openssl',
    ['enc', '-aes-256-cbc', '-d', '-a', '-md', 'sha256', '-pass', 'env:VAULT_PASSWORD', '-in', vaultFile],
    { env: Object.assign({}, process.env, { VAULT_PASSWORD: vp }) }
  );
  const data = JSON.parse(out.toString());
  const k = data['freellmapi-encryption-key'];
  if (k) process.stdout.write(k);
} catch (e) {
  process.exit(0);
}
