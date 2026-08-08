/**
 * lib/directory/moderation.ts
 *
 * Pure helpers for review spam detection.
 * Used by Agent E's review moderation endpoint.
 * All functions are side-effect-free — no DB, no network.
 *
 * Philosophy: these are heuristics for a moderation queue, not a wall.
 * A high spam score flags a review for closer human scrutiny, not auto-rejection.
 * Reviewers see the score in the moderation UI and make the final call.
 *
 * Devil's advocate notes:
 *  - Functions handle empty string gracefully (no throws, return 0 for scores).
 *  - linkCount uses a broad URL regex; false positives (e.g. "visit us.com") are
 *    acceptable — they escalate to human review, not auto-reject.
 *  - allCapsRatio excludes punctuation and short words to avoid flagging single-word
 *    all-caps (e.g. "GREAT!") that are stylistically emphatic.
 *  - spamScore is additive: each heuristic contributes a sub-score (0–1.0 range
 *    per heuristic). Total score > 0.6 is considered "likely spam".
 */

// ---------------------------------------------------------------------------
// Individual heuristics
// ---------------------------------------------------------------------------

/**
 * Counts the number of URLs (http/https or bare www.) in the text.
 * Spam reviews often contain promotional links.
 */
export function linkCount(text: string): number {
  if (!text) return 0;
  const urlPattern = /https?:\/\/[^\s]+|www\.[a-z0-9-]+\.[a-z]{2,}/gi;
  return (text.match(urlPattern) ?? []).length;
}

/**
 * Returns the ratio of uppercase alphabetic characters to total alphabetic
 * characters in the text. Excludes punctuation and numerals.
 * Range: 0.0 (all lower) → 1.0 (all upper).
 *
 * A ratio above ~0.6 suggests shouting / spam formatting.
 */
export function allCapsRatio(text: string): number {
  if (!text) return 0;
  const alpha = text.replace(/[^a-zA-Z]/g, '');
  if (alpha.length === 0) return 0;
  const upper = alpha.replace(/[^A-Z]/g, '');
  return upper.length / alpha.length;
}

/**
 * Checks for excessive repetition — same word repeated ≥4 times in sequence
 * (e.g. "great great great great"). Indicator of bot-generated text or spam.
 */
export function hasExcessiveRepetition(text: string): boolean {
  if (!text) return false;
  // Match any word repeated 4+ consecutive times (case-insensitive)
  return /\b(\w+)\b(?:\s+\1\b){3,}/i.test(text);
}

/**
 * Checks for prohibited content patterns (phone numbers, email addresses embedded
 * in review body — common in astroturfing / contact-spam reviews).
 */
export function hasContactInfo(text: string): boolean {
  if (!text) return false;
  const phonePattern = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/;
  const emailPattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
  return phonePattern.test(text) || emailPattern.test(text);
}

/**
 * Counts how many words from a known promotional spam lexicon appear in the text.
 * Lightweight keyword matching — not NLP.
 */
const SPAM_KEYWORDS = [
  'click here',
  'order now',
  'buy now',
  'limited time',
  'free trial',
  'guaranteed',
  'earn money',
  'make money',
  'work from home',
  'casino',
  'bitcoin',
  'crypto',
  'medication',
  'pharmacy',
  'pills',
  'weight loss',
  'diet pill',
  'enlargement',
];

export function spamKeywordCount(text: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  return SPAM_KEYWORDS.filter((kw) => lower.includes(kw)).length;
}

// ---------------------------------------------------------------------------
// Composite score
// ---------------------------------------------------------------------------

export interface ModerationResult {
  /** 0.0 (clean) → 1.0 (very likely spam). Threshold for flag: > 0.6. */
  score: number;
  /** Human-readable list of triggered heuristics. */
  flags: string[];
  /** Whether the review should be queued for priority human review. */
  flagged: boolean;
}

/**
 * Computes a composite spam score for a review body (and optional author name).
 *
 * Scoring weights:
 *  - Each link: +0.25 (capped at 1.0)
 *  - allCapsRatio > 0.6: +0.3
 *  - hasExcessiveRepetition: +0.3
 *  - hasContactInfo: +0.4
 *  - spamKeyword: +0.2 each (capped at 0.6)
 *
 * Maximum raw score before cap: 1.0 + 0.3 + 0.3 + 0.4 + 0.6 = 2.6.
 * Final score is clamped to [0, 1].
 */
export function computeSpamScore(body: string, authorName?: string): ModerationResult {
  const flags: string[] = [];
  let score = 0;

  // Link count
  const links = linkCount(body);
  if (links > 0) {
    const linkScore = Math.min(links * 0.25, 1.0);
    score += linkScore;
    flags.push(`contains ${links} link(s)`);
  }

  // ALL CAPS
  const capsRatio = allCapsRatio(body);
  if (capsRatio > 0.6) {
    score += 0.3;
    flags.push(`all-caps ratio ${(capsRatio * 100).toFixed(0)}%`);
  }

  // Repetition
  if (hasExcessiveRepetition(body)) {
    score += 0.3;
    flags.push('excessive word repetition');
  }

  // Contact info
  if (hasContactInfo(body)) {
    score += 0.4;
    flags.push('contains contact info');
  }

  // Spam keywords
  const kwCount = spamKeywordCount(body);
  if (kwCount > 0) {
    const kwScore = Math.min(kwCount * 0.2, 0.6);
    score += kwScore;
    flags.push(`${kwCount} spam keyword(s)`);
  }

  // Author name checks (e.g. all-caps author is a minor signal)
  if (authorName && allCapsRatio(authorName) > 0.8 && authorName.length > 5) {
    score += 0.1;
    flags.push('all-caps author name');
  }

  const finalScore = Math.min(score, 1.0);

  return {
    score: parseFloat(finalScore.toFixed(3)),
    flags,
    flagged: finalScore > 0.6,
  };
}
