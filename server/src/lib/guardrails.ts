// ── Request-level guardrails (策略 24 / 循环工程：反 Goodhart 护栏） ──
//
// 两个可在运行时通过 settings 表调整、无需重启即可生效的硬护栏：
//
//  1. request_max_tokens_budget  — 单请求 token 成本天花板（输入 + 输出上限）。
//     0 = 不限制（默认，保持现有行为）。>0 时，若预估总 token 超过上限，
//     请求在路由前被硬拒（413）；流式生成中累计输出超预算则提前截断（early stop）。
//     对应蓝图 P1「FreeLLMAPI 路由预算上限 / 早停」—— 禁止用"成功率/延迟"等
//     代理指标替代成本目标，给内环（路由自主）一个真实的成本天花板。
//
//  2. max_consecutive_upstream_fails — 连续上游失败断路器。
//     0 = 不启用（默认，保持现有 MAX_RETRIES 行为）。>0 时，若连续 N 次上游
//     真实失败（可重试错误：429/5xx/404/空完成等），立即跳闸中止整条 failover
//     链，返回 503。避免"整池不健康"时仍逐个轰完所有模型、空烧额度与延迟。
//
// 两者默认均为 0（关闭），因此对未配置的用户行为零变化。

import { getSetting } from '../db/index.js';

export const SETTING_REQUEST_MAX_TOKENS_BUDGET = 'request_max_tokens_budget';
export const SETTING_MAX_CONSECUTIVE_UPSTREAM_FAILS = 'max_consecutive_upstream_fails';

/** 单请求 token 预算上限；0 = 不限制。 */
export function getRequestMaxTokensBudget(): number {
  const raw = getSetting(SETTING_REQUEST_MAX_TOKENS_BUDGET);
  if (raw == null) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 连续上游失败断路器阈值；0 = 不启用。 */
export function getMaxConsecutiveUpstreamFails(): number {
  const raw = getSetting(SETTING_MAX_CONSECUTIVE_UPSTREAM_FAILS);
  if (raw == null) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 单请求是否超出 token 预算（pre-flight 用）。budget<=0 视为不限制。 */
export function exceedsTokenBudget(estimatedTotal: number, budget: number): boolean {
  return budget > 0 && estimatedTotal > budget;
}

// ── 断路器状态机（每个请求一份，循环内复用） ──
export interface CircuitBreakerState {
  consecutive: number;
  tripped: boolean;
}

export function newBreaker(): CircuitBreakerState {
  return { consecutive: 0, tripped: false };
}

/**
 * 记录一次真实上游失败。若达到阈值则将 state.tripped 置真。
 * 阈值 <=0（未启用）时本函数为 no-op，保持原有 MAX_RETRIES 行为。
 */
export function recordUpstreamFailure(state: CircuitBreakerState): void {
  const limit = getMaxConsecutiveUpstreamFails();
  if (limit <= 0) return;
  state.consecutive += 1;
  if (state.consecutive >= limit) state.tripped = true;
}

/** 一次成功即清零连续失败计数（链路恢复）。 */
export function resetBreaker(state: CircuitBreakerState): void {
  state.consecutive = 0;
}
