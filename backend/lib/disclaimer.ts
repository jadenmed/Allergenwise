/**
 * lib/disclaimer.ts
 * Single source of truth for the Required Disclaimer Language.
 *
 * Verbatim from the AllergenWise Master Course Build Packet
 * ("Required Disclaimer Language"). Do NOT edit, paraphrase, or inline this
 * string elsewhere — every learner-visible certificate surface imports it from
 * here so the legal copy stays identical across the certificate PDF, the
 * learner completion/certificate pages, the public verification page, and the
 * marketing footer.
 *
 * This module is intentionally dependency-free (no `fs`, no Node-only imports)
 * so it is safe to import from both Server and Client Components. It is also
 * re-exported from lib/curriculum.ts per the packet build prompt (Step 4).
 */
export const DISCLAIMER =
  'No restaurant can guarantee a completely allergen-free environment. This training is designed to support allergen risk reduction through education, communication, and structured procedures.';

// ─── Other canonical packet constants (dependency-free, client+server safe) ──
// All values verbatim from the AllergenWise Curriculum Source file. Re-exported
// from lib/curriculum.ts. Never inline these strings at call sites.

/** Individual certification name (source: "CERTIFICATION STRUCTURE → Name"). */
export const CERT_NAME = 'AllergenWise Certification';

/** Certificate validity (source: "Certificate Validity: 2 years"). */
export const CERT_VALIDITY_YEARS = 2;

/**
 * Restaurant participation recognition language.
 * Source: "RESTAURANT PARTICIPATION SYSTEM → Recommended Restaurant
 * Recognition Language" (USE list). Use these on public-facing participation
 * materials; never the forbidden phrases below.
 */
export const PARTICIPATION_LANGUAGE_ALLOWED = [
  'AllergenWise Trained Team',
  'AllergenWise Participating Location',
  'AllergenWise Risk Reduction Partner',
] as const;

/**
 * Forbidden participation phrases (source: same section, DO NOT USE list).
 * These over-promise safety and contradict the Required Disclaimer Language.
 */
export const PARTICIPATION_LANGUAGE_FORBIDDEN = [
  'Allergen-Free Certified',
  'Guaranteed Safe',
] as const;

/**
 * Optional restaurant operational badges (source: "OPTIONAL RESTAURANT BADGES
 * / ICON SYSTEM"). These reflect operational practices and must NOT be
 * presented as guarantees of allergen-free food.
 */
export const OPTIONAL_BADGES = [
  'Peanut Aware',
  'Sesame Restricted',
  'Dedicated Fryer',
  'Dedicated Prep Area',
  'Staff Allergen Trained',
] as const;
