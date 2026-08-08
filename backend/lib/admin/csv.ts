/**
 * lib/admin/csv.ts
 * Pure CSV parse + validation for bulk employee invite uploads.
 * No DB calls — all DB deduplication is passed in as existing emails set.
 *
 * Tested by: tests/unit/csv-parse.test.ts
 */
import Papa from 'papaparse';
import { z } from 'zod';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_CSV_ROWS = 200;
export const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB — DoS pre-buffer cap (audit P1-10)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CsvRow {
  email: string;
  fullName: string;
  jobRole: string;
}

export interface CsvRowError {
  row: number; // 1-based (row 1 = first data row after header)
  field: string;
  message: string;
  rawData?: Record<string, string>;
}

export interface CsvParseResult {
  validRows: CsvRow[];
  errors: CsvRowError[];
  totalParsed: number;
  duplicatesSkipped: string[]; // emails already in DB
}

// ─── Zod row schema ───────────────────────────────────────────────────────────

const CsvRowSchema = z.object({
  email: z.string().min(1, 'Email is required').regex(EMAIL_RE, 'Invalid email format'),
  fullName: z.string().min(1, 'Full name is required').max(200, 'Full name too long'),
  jobRole: z.string().min(1, 'Job role is required').max(100, 'Job role too long'),
});

// ─── Header normalizer ────────────────────────────────────────────────────────
// Accepts headers: email, full_name / fullName / full name, job_role / jobRole / job role
function normalizeHeaders(raw: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, '');
    if (key === 'email') normalized['email'] = v?.trim() ?? '';
    else if (key === 'fullname') normalized['fullName'] = v?.trim() ?? '';
    else if (key === 'jobrole') normalized['jobRole'] = v?.trim() ?? '';
  }
  return normalized;
}

// ─── Main parse function ──────────────────────────────────────────────────────

/**
 * Parse a CSV string and validate each row.
 *
 * @param csvText - Raw CSV text content
 * @param existingEmails - Set of emails already in the DB for this restaurant
 *                         (used for deduplication — NOT a DB call; caller provides)
 * @returns CsvParseResult
 */
export function parseCsv(csvText: string, existingEmails: Set<string>): CsvParseResult {
  const validRows: CsvRow[] = [];
  const errors: CsvRowError[] = [];
  const duplicatesSkipped: string[] = [];

  // PapaParse configuration
  const result = Papa.parse<Record<string, string>>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) =>
      h
        .toLowerCase()
        .trim()
        .replace(/[\s_]+/g, ''),
  });

  const totalParsed = result.data.length;

  // ── Size limit check ──────────────────────────────────────────────────────
  if (totalParsed > MAX_CSV_ROWS) {
    errors.push({
      row: 0,
      field: 'file',
      message: `CSV exceeds maximum of ${MAX_CSV_ROWS} rows (found ${totalParsed}). Split into smaller files.`,
    });
    // Still return what we have for diagnostic purposes, but don't process rows
    return { validRows: [], errors, totalParsed, duplicatesSkipped };
  }

  // ── Empty file check ──────────────────────────────────────────────────────
  if (totalParsed === 0) {
    errors.push({
      row: 0,
      field: 'file',
      message: 'CSV file is empty or contains only a header row.',
    });
    return { validRows: [], errors, totalParsed, duplicatesSkipped };
  }

  // ── Track emails seen in this upload (within-file dedup) ─────────────────
  const seenInUpload = new Set<string>();

  // ── Process each row ──────────────────────────────────────────────────────
  result.data.forEach((rawRow, idx) => {
    const rowNum = idx + 1; // 1-based

    // Remap common header variations
    const normalized = normalizeHeaders(rawRow as Record<string, string>);

    // Validate with Zod
    const parsed = CsvRowSchema.safeParse({
      email: normalized['email'] ?? '',
      fullName: normalized['fullName'] ?? '',
      jobRole: normalized['jobRole'] ?? '',
    });

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          row: rowNum,
          field: issue.path.join('.'),
          message: issue.message,
          rawData: rawRow as Record<string, string>,
        });
      }
      return;
    }

    const row = parsed.data;
    const emailLower = row.email.toLowerCase();

    // Within-file deduplication
    if (seenInUpload.has(emailLower)) {
      errors.push({
        row: rowNum,
        field: 'email',
        message: `Duplicate email within upload: ${row.email}`,
        rawData: rawRow as Record<string, string>,
      });
      return;
    }
    seenInUpload.add(emailLower);

    // Deduplication vs existing DB profiles
    if (existingEmails.has(emailLower)) {
      duplicatesSkipped.push(row.email);
      return;
    }

    validRows.push({ ...row, email: emailLower });
  });

  return { validRows, errors, totalParsed, duplicatesSkipped };
}
