import type { ModelListRow } from '@freellmapi/shared/types.js';
import { getDb } from '../db/index.js';
import { isUnifyEnabled, getModelGroups } from './model-groups.js';

// Shared catalog-listing logic behind both the OpenAI `GET /v1/models` and the
// Anthropic `GET /v1/models` endpoints, so the two wire formats list the exact
// same models (only the envelope differs). Extracted verbatim from the OpenAI
// proxy route to keep a single source of truth.

export interface NormalizedModel {
  id: string;
  name: string;
  ownedBy: string;
  available: number;
  enabled: number;
  contextWindow: number | null;
  intel: number;
  // Local fork enrichment (dashboard / analytics)
  category: string | null;
  lastVerifiedAt: string | null;
  probeStatus: number;
  rateLimit: string;
  tier: string;
  requiresCreditCard: boolean;
  // Upstream additions
  platforms: string[];
  supportsTools: boolean;
}

export interface ModelListing {
  // Full catalog, sorted usable-first; callers apply their own `available` filter.
  models: NormalizedModel[];
  // Honest ceiling for the virtual "auto" model: the largest context window
  // among models that can serve a request right now (null when nothing is
  // connected). Computed over available models regardless of any caller filter.
  autoContextWindow: number | null;
}

export function buildModelListing(): ModelListing {
  const availableExpr = `
    (CASE WHEN m.enabled = 1 AND EXISTS (
        SELECT 1 FROM api_keys k
        WHERE k.platform = m.platform
          AND k.enabled = 1
          AND (m.key_id IS NULL OR k.id = m.key_id)
      ) THEN 1 ELSE 0 END)`;
  const db = getDb();

  let allListed: NormalizedModel[];

  if (isUnifyEnabled()) {
    // Unify ON: one entry per logical model group. Pull per-row availability +
    // context keyed by db id, then aggregate over each group's members.
    type AvailRow = { id: number; platform: string; intelligence_rank: number; context_window: number | null; enabled: number; available: number; category: string | null; last_verified_at: string | null; probe_status: number; rpm_limit: number | null; rpd_limit: number | null; tpm_limit: number | null; tpd_limit: number | null; paid_input_per_m: number | null; paid_output_per_m: number | null; supports_tools: number };
    const rows = db.prepare(`
      SELECT m.id, m.platform, m.intelligence_rank, m.context_window,
             m.enabled AS enabled, ${availableExpr} AS available,
             m.category, m.last_verified_at, m.probe_status,
             m.rpm_limit, m.rpd_limit, m.tpm_limit, m.tpd_limit,
             m.paid_input_per_m, m.paid_output_per_m,
             m.supports_tools
      FROM models m
    `).all() as AvailRow[];
    const byId = new Map(rows.map(r => [r.id, r]));
    allListed = getModelGroups().map(g => {
      const infos = g.members.map(m => byId.get(m.model_db_id)).filter(Boolean) as AvailRow[];
      const ctxs = infos.map(i => i.context_window).filter((c): c is number => c != null);
      const rep = infos[0]; // use first representative for category/tier/rateLimit
      const rateLimit = [
        rep?.rpm_limit ? `${rep.rpm_limit} RPM` : null,
        rep?.rpd_limit ? `${rep.rpd_limit} RPD` : null,
        rep?.tpm_limit ? `${rep.tpm_limit} TPM` : null,
        rep?.tpd_limit ? `${rep.tpd_limit} TPD` : null,
      ].filter(Boolean).join(' / ') || 'unknown';
      const tier = rep?.paid_input_per_m != null || rep?.paid_output_per_m != null ? 'paid' : 'free';
      const requiresCreditCard = rep?.platform === 'nvidia' || rep?.platform === 'groq' || rep?.platform === 'mistral';
      return {
        id: g.canonicalId,
        name: g.groupLabel,
        ownedBy: 'freellmapi',
        available: infos.some(i => i.available === 1) ? 1 : 0,
        enabled: infos.some(i => i.enabled === 1) ? 1 : 0,
        contextWindow: ctxs.length ? Math.max(...ctxs) : null,
        intel: infos.length ? Math.min(...infos.map(i => i.intelligence_rank)) : Number.MAX_SAFE_INTEGER,
        category: rep?.category ?? 'chat',
        lastVerifiedAt: rep?.last_verified_at ?? null,
        probeStatus: rep?.probe_status ?? 0,
        rateLimit,
        tier,
        requiresCreditCard,
        platforms: [...new Set(infos.map(i => i.platform))],
        supportsTools: infos.some(i => i.supports_tools === 1),
      };
    });
  } else {
    // Unify OFF: one entry per model_id (dedup picks the available, smartest
    // representative row).
    const models = db.prepare(`
      SELECT platform, model_id, display_name, context_window, enabled, available, intelligence_rank, id,
             category, last_verified_at, probe_status,
             rpm_limit, rpd_limit, tpm_limit, tpd_limit,
             paid_input_per_m, paid_output_per_m,
             supports_tools
      FROM (
        SELECT m.platform, m.model_id, m.display_name, m.context_window, m.intelligence_rank, m.id, m.supports_tools,
               m.enabled AS enabled,
               ${availableExpr} AS available,
               m.category, m.last_verified_at, m.probe_status,
               m.rpm_limit, m.rpd_limit, m.tpm_limit, m.tpd_limit,
               m.paid_input_per_m, m.paid_output_per_m,
               ROW_NUMBER() OVER (
                 PARTITION BY m.model_id
                 ORDER BY ${availableExpr} DESC, m.intelligence_rank ASC, m.id ASC
               ) AS rn
        FROM models m
      )
      WHERE rn = 1
    `).all() as (ModelListRow & { intelligence_rank: number; id: number; supports_tools: number; category: string | null; last_verified_at: string | null; probe_status: number; rpm_limit: number | null; rpd_limit: number | null; tpm_limit: number | null; tpd_limit: number | null; paid_input_per_m: number | null; paid_output_per_m: number | null })[];
    allListed = models.map(m => {
      const rateLimit = [
        m.rpm_limit ? `${m.rpm_limit} RPM` : null,
        m.rpd_limit ? `${m.rpd_limit} RPD` : null,
        m.tpm_limit ? `${m.tpm_limit} TPM` : null,
        m.tpd_limit ? `${m.tpd_limit} TPD` : null,
      ].filter(Boolean).join(' / ') || 'unknown';
      const tier = m.paid_input_per_m != null || m.paid_output_per_m != null ? 'paid' : 'free';
      const requiresCreditCard = m.platform === 'nvidia' || m.platform === 'groq' || m.platform === 'mistral';
      return {
        id: m.model_id, name: m.display_name, ownedBy: m.platform,
        available: m.available, enabled: m.enabled, contextWindow: m.context_window,
        intel: m.intelligence_rank,
        category: m.category ?? 'chat',
        lastVerifiedAt: m.last_verified_at ?? null,
        probeStatus: m.probe_status ?? 0,
        rateLimit,
        tier,
        requiresCreditCard,
        platforms: [m.platform],
        supportsTools: m.supports_tools === 1,
      };
    });
  }

  // Stable order: usable first, then enabled, then smartest, then name.
  allListed.sort((a, b) =>
    (b.available - a.available) || (b.enabled - a.enabled) || (a.intel - b.intel) || a.name.localeCompare(b.name));

  const availableContextWindows = allListed
    .filter(m => m.available === 1 && m.contextWindow != null)
    .map(m => m.contextWindow as number);
  const autoContextWindow = availableContextWindows.length > 0
    ? Math.max(...availableContextWindows)
    : null;

  return { models: allListed, autoContextWindow };
}
