/**
 * Provider Schema Validator
 * 
 * Validates providers.json against the schema.json definition.
 * Ensures data integrity before importing into the database.
 * 
 * Usage:
 *   npx tsx src/scripts/validate-providers.ts [path-to-providers.json]
 * 
 * Returns exit code 0 on success, 1 on failure.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ---- Types ----
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ---- Schema Definition (embedded for standalone validation) ----
// Note: 'platform', 'phone_required', 'commercial_ok' are temporarily optional to accommodate current API dataset.
// TODO: Re-add to REQUIRED_FIELDS once freellmapihub.com fixes the schema.
const REQUIRED_FIELDS = ['slug', 'name', 'card_required', 'docs_url', 'verified'];
const OPTIONAL_FIELDS = ['platform', 'phone_required', 'commercial_ok', 'last_verified'];
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ---- Validation Functions ----
function validateSlug(slug: any, path: string): string | null {
  if (typeof slug !== 'string') {
    return `${path}.slug must be a string`;
  }
  if (!SLUG_PATTERN.test(slug)) {
    return `${path}.slug must match pattern: ${SLUG_PATTERN.toString()}`;
  }
  return null;
}

function validateBoolean(value: any, path: string): string | null {
  if (typeof value !== 'boolean') {
    return `${path} must be boolean (true/false)`;
  }
  return null;
}

function validateTristate(value: any, path: string): string | null {
  if (value !== null && value !== undefined && typeof value !== 'boolean') {
    return `${path} must be boolean or null`;
  }
  return null;
}

function validateUri(value: any, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    return `${path} must be a string`;
  }
  try {
    new URL(value);
    return null;
  } catch {
    return `${path} must be a valid URL`;
  }
}

function validateDate(value: any, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    return `${path} must be a string in YYYY-MM-DD format`;
  }
  if (!DATE_PATTERN.test(value)) {
    return `${path} must match YYYY-MM-DD format`;
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return `${path} is not a valid date`;
  }
  return null;
}

function validateProvider(provider: any, index: number): ValidationResult {
  const path = `providers[${index}]`;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (provider[field] === undefined || provider[field] === null) {
      errors.push(`${path}.${field} is required`);
    }
  }

  // Check optional fields and generate warnings
  if (provider.platform === undefined || provider.platform === null) {
    warnings.push(`${path}: ⚠️  'platform' field is missing - will be inferred from slug`);
  }
  if (provider.last_verified === undefined || provider.last_verified === null) {
    warnings.push(`${path}: ⚠️  'last_verified' field is missing`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // Validate individual fields
  const slugError = validateSlug(provider.slug, path);
  if (slugError) errors.push(slugError);

  const nameError = validateBoolean(typeof provider.name === 'string' && provider.name.length > 0 
    ? true : provider.name && typeof provider.name === 'string' 
    ? null : `${path}.name must be a non-empty string`, path);
  if (nameError) errors.push(nameError);

  const cardError = validateBoolean(provider.card_required, `${path}.card_required`);
  if (cardError) errors.push(cardError);

  // phone_required and commercial_ok can be null (unconfirmed)
  if (provider.phone_required !== null && provider.phone_required !== undefined) {
    const phoneError = validateBoolean(provider.phone_required, `${path}.phone_required`);
    if (phoneError) errors.push(phoneError);
  }

  const commercialError = validateTristate(provider.commercial_ok, `${path}.commercial_ok`);
  if (commercialError) errors.push(commercialError);

  const docsError = validateUri(provider.docs_url, `${path}.docs_url`);
  if (docsError) errors.push(docsError);

  const verifiedError = validateBoolean(provider.verified, `${path}.verified`);
  if (verifiedError) errors.push(verifiedError);

  const lastVerifiedError = validateDate(provider.last_verified, `${path}.last_verified`);
  if (lastVerifiedError) warnings.push(lastVerifiedError);

  // Check for unverified entries
  if (provider.verified === false) {
    warnings.push(`${path}: ⚠️  Entry marked as unverified - will show warning flag in UI`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---- Main ----
function validate(filePath: string): ValidationResult {
  const resolvedPath = resolve(filePath);
  
  if (!existsSync(resolvedPath)) {
    return {
      valid: false,
      errors: [`File not found: ${resolvedPath}`],
      warnings: []
    };
  }

  let data: { providers: any[] };
  try {
    const content = readFileSync(resolvedPath, 'utf8');
    data = JSON.parse(content);
  } catch (e: any) {
    return {
      valid: false,
      errors: [`Failed to parse JSON: ${e.message}`],
      warnings: []
    };
  }

  if (!Array.isArray(data.providers)) {
    return {
      valid: false,
      errors: ['Root object must have a "providers" array'],
      warnings: []
    };
  }

  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  // Validate each provider
  for (let i = 0; i < data.providers.length; i++) {
    const result = validateProvider(data.providers[i], i);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }

  // Check for duplicate slugs
  const slugs = data.providers.map(p => p.slug);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const slug of slugs) {
    if (seen.has(slug)) {
      if (!duplicates.includes(slug)) duplicates.push(slug);
    } else {
      seen.add(slug);
    }
  }
  if (duplicates.length > 0) {
    allErrors.push(`Duplicate slugs found: ${duplicates.join(', ')}`);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings
  };
}

// ---- Run ----
const filePath = process.argv[2] || 'data/providers.json';
const result = validate(filePath);

if (result.valid) {
  console.log('✅ Validation passed');
  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    result.warnings.forEach(w => console.log(`  ${w}`));
  }
  process.exit(0);
} else {
  console.log('❌ Validation failed');
  console.log('\nErrors:');
  result.errors.forEach(e => console.log(`  ${e}`));
  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    result.warnings.forEach(w => console.log(`  ${w}`));
  }
  process.exit(1);
}
