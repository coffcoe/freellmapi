import type Database from 'better-sqlite3';
import * as legacyBaseline from '../migrations/20260101_000000_legacy_baseline.js';
import * as customProviderModalities from '../migrations/20260627_000001_custom_provider_modalities.js';
import * as catalogModelState from '../migrations/20260627_000002_catalog_model_state.js';
import * as requestAggregates from '../migrations/20260628_120000_request_aggregates.js';
import * as githubGpt41Context from '../migrations/20260630_000001_github_gpt41_context.js';
import * as addCategoryToModels from '../migrations/20260701_000001_add_category_to_models.js';
import * as addProbeFields from '../migrations/20260701_000002_add_probe_fields.js';
import * as quotaGuardColumns from '../migrations/20260802_000000_quota_guard_columns.js';

export interface MigrationModule {
  up(db: Database.Database): void;
  down(db: Database.Database): void;
}

export interface DefaultMigration {
  filename: string;
  module: MigrationModule;
}

export const LEGACY_BASELINE_FILENAME = '20260101_000000_legacy_baseline.ts';
export const CUSTOM_PROVIDER_MODALITIES_FILENAME = '20260627_000001_custom_provider_modalities.ts';
export const CATALOG_MODEL_STATE_FILENAME = '20260627_000002_catalog_model_state.ts';
export const REQUEST_AGGREGATES_FILENAME = '20260628_120000_request_aggregates.ts';
export const GITHUB_GPT41_CONTEXT_FILENAME = '20260630_000001_github_gpt41_context.ts';
export const ADD_CATEGORY_TO_MODELS_FILENAME = '20260701_000001_add_category_to_models.ts';
export const ADD_PROBE_FIELDS_FILENAME = '20260701_000002_add_probe_fields.ts';
export const QUOTA_GUARD_COLUMNS_FILENAME = '20260802_000000_quota_guard_columns.ts';

export const DEFAULT_MIGRATIONS: readonly DefaultMigration[] = [
  { filename: LEGACY_BASELINE_FILENAME, module: legacyBaseline },
  { filename: CUSTOM_PROVIDER_MODALITIES_FILENAME, module: customProviderModalities },
  { filename: CATALOG_MODEL_STATE_FILENAME, module: catalogModelState },
  { filename: REQUEST_AGGREGATES_FILENAME, module: requestAggregates },
  { filename: GITHUB_GPT41_CONTEXT_FILENAME, module: githubGpt41Context },
  { filename: ADD_CATEGORY_TO_MODELS_FILENAME, module: addCategoryToModels },
  { filename: ADD_PROBE_FIELDS_FILENAME, module: addProbeFields },
  { filename: QUOTA_GUARD_COLUMNS_FILENAME, module: quotaGuardColumns },
];
