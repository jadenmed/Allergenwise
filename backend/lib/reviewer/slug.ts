/**
 * lib/reviewer/slug.ts
 *
 * Pure JS slug generator that mirrors the behavior of unique_slug() in
 * db/migrations/0009_decide_submission_fn.sql.
 *
 * Used:
 *  - In unit tests (no DB needed).
 *  - As a fallback if the SQL function is unavailable (e.g., local dev without Supabase).
 *
 * The collision suffix strategy (-2, -3, ...) is identical to the SQL version.
 * Callers that need DB-backed uniqueness must use the SQL function directly.
 */

/**
 * Converts a single string to a kebab-case slug segment.
 * Strips accents, lowercases, and replaces any run of non-alphanumeric chars
 * with a single hyphen. Trims leading/trailing hyphens.
 */
export function toKebab(input: string): string {
  if (!input || input.trim() === '') return '';

  return (
    input
      // Normalize unicode: decompose accented chars so the base letter survives
      .normalize('NFD')
      // Strip combining marks (accents, diacritics)
      .replace(/[̀-ͯ]/g, '')
      // Lowercase
      .toLowerCase()
      // Replace any sequence of non-alphanumeric characters with a hyphen
      .replace(/[^a-z0-9]+/g, '-')
      // Trim leading/trailing hyphens
      .replace(/^-+|-+$/g, '')
  );
}

/**
 * Generates a base slug from restaurant name + city.
 * Matches unique_slug() SQL: concat with space, then toKebab.
 */
export function baseSlug(name: string, city: string): string {
  const combined = [name, city].filter(Boolean).join(' ');
  const slug = toKebab(combined);
  return slug || 'restaurant';
}

/**
 * Generates a unique slug by checking the given set of existing slugs.
 * Appends -2, -3, ... on collision, matching the SQL unique_slug() function.
 *
 * @param name         Restaurant name
 * @param city         Restaurant city
 * @param existingSlugs Set of slugs already taken (e.g., fetched from DB)
 * @returns            A slug not present in existingSlugs
 */
export function uniqueSlug(
  name: string,
  city: string,
  existingSlugs: ReadonlySet<string> = new Set()
): string {
  const base = baseSlug(name, city);
  if (!existingSlugs.has(base)) return base;

  for (let i = 2; i <= 999; i++) {
    const candidate = `${base}-${i}`;
    if (!existingSlugs.has(candidate)) return candidate;
  }

  // Pathological case: append epoch millis (mirrors SQL fallback)
  return `${base}-${Date.now()}`;
}

/**
 * Convenience: synchronously generate a unique slug given an array of existing slugs.
 * Use when you already have the existing slugs in memory.
 */
export function uniqueSlugFromArray(name: string, city: string, existingSlugs: string[]): string {
  return uniqueSlug(name, city, new Set(existingSlugs));
}
