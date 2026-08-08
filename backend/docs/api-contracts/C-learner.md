# API Contract — Agent C: Learner Domain APIs

**Version:** 1.0  
**Author:** Phase 1 Agent C + Phase 1 Finisher Agent  
**Downstream consumers:** Phase 3 UI agents (learner home, course player, exam, complete, certificate screens)

All routes are server-side only. Learner role required unless noted. All bodies JSON. All responses JSON.

---

## POST /api/lesson/progress

### Purpose
Reports learner video progress for a specific lesson. Upserts `lesson_progress`. Marks lesson complete when watched ≥90% of video duration. Enforces module lock (cannot progress in a locked module).

### Auth
Learner session required.

### Request

```json
{
  "lessonId": "uuid",
  "watchedSeconds": 220
}
```

### Response — 200 OK

```json
{
  "ok": true,
  "status": "in_progress",
  "watchedSeconds": 220,
  "justCompleted": false
}
```

`status`: `"not_started" | "in_progress" | "complete"`  
`justCompleted`: `true` only on the exact call that transitions to `complete`.

### Errors

| HTTP | Meaning |
|------|---------|
| 400 | Validation failed |
| 401 | Not authenticated |
| 403 | Not a learner, OR module is locked |
| 404 | Lesson not found |
| 422 | Anti-cheat: `watchedSeconds` exceeds wall-clock elapsed time |

### Anti-cheat behavior
`watchedSeconds` is compared against wall-clock time elapsed since `lesson_progress.started_at`. If the claimed watch time exceeds 50% of elapsed real time, the request is rejected with 422. The server always uses `max(existing, incoming)` for `watched_seconds` — seeking backward doesn't lose progress.

### Module lock logic
Module N is locked until all lessons in Module N-1 have `status='complete'`. This is checked server-side; client cannot bypass by POSTing progress for a locked lesson.

---

## POST /api/lesson/[lessonId]/complete

### Purpose
Hard-marks a lesson as complete. Intended as an insurance POST when the video `ended` event fires, or as an admin override for demo scenarios. Skips the anti-cheat wall-clock check (unlike `/api/lesson/progress`).

### Auth
Learner or admin session required. Admins can only mark their own lessons (not on behalf of another learner).

### Request
No body. `lessonId` in URL path.

### Response — 200 OK

```json
{
  "ok": true,
  "status": "complete",
  "justCompleted": false
}
```

### Errors

| HTTP | Meaning |
|------|---------|
| 400 | Invalid lessonId format |
| 401 | Not authenticated |
| 403 | Module locked |
| 404 | Lesson or module not found |

---

## GET /api/learner/home-data

### Purpose
Returns the full data needed for the learner home page: all modules with per-lesson progress, exam unlock status, and (if certified) the certificate summary.

### Auth
Learner session required.

### Response — 200 OK

```json
{
  "modules": [
    {
      "id": "uuid",
      "title": "Allergen Fundamentals",
      "orderIndex": 1,
      "estimatedMinutes": 45,
      "status": "complete",
      "completedCount": 6,
      "totalCount": 6,
      "lessons": [
        {
          "id": "uuid",
          "title": "What Are Allergens?",
          "orderIndex": 1,
          "status": "complete",
          "watchedSeconds": 222,
          "totalSeconds": 222
        }
      ]
    }
  ],
  "examUnlocked": true,
  "certificate": {
    "certCode": "AW-2026-000001",
    "issuedAt": "2026-04-01T10:00:00Z",
    "expiresAt": "2027-04-01T10:00:00Z",
    "pdfUrl": "https://..."
  }
}
```

`module.status`: `"locked" | "not_started" | "in_progress" | "complete"`  
`lesson.status`: `"locked" | "not_started" | "in_progress" | "complete"`  
`examUnlocked`: `true` only when all 5 modules are `complete`.  
`certificate`: omitted if learner has no valid (non-revoked) certificate.  
`pdfUrl`: 1-hour signed Supabase Storage URL, or `null` if PDF not yet generated.

### Errors

| HTTP | Meaning |
|------|---------|
| 401 | Not authenticated |
| 403 | Not a learner |

---

## GET /api/learner/certificate

### Purpose
Returns the learner's own certificate metadata and a fresh signed PDF download URL.

### Auth
Learner session required.

### Response — 200 OK

```json
{
  "certCode": "AW-2026-000001",
  "issuedAt": "2026-04-01T10:00:00Z",
  "expiresAt": "2027-04-01T10:00:00Z",
  "pdfUrl": "https://supabase-signed-url...",
  "status": "valid"
}
```

`status`: `"valid" | "expired" | "revoked"`

### Errors

| HTTP | Meaning |
|------|---------|
| 401 | Not authenticated |
| 403 | Not a learner |
| 404 | No certificate found |

---

## POST /api/exam/start

### Purpose
Starts a new exam attempt. Performs all server-side eligibility checks, draws 25 random questions (5 per module), inserts `exam_attempts` row, returns questions (without correct answers).

### Auth
Learner session required.

### Request
No body.

### Response — 200 OK

```json
{
  "attemptId": "uuid",
  "questions": [
    {
      "id": "uuid",
      "question": "Which symptom indicates anaphylaxis?",
      "options": [
        { "id": "opt-uuid-1", "text": "Mild itching" },
        { "id": "opt-uuid-2", "text": "Throat swelling and difficulty breathing" }
      ]
    }
  ],
  "startedAt": "2026-04-30T12:00:00Z",
  "timeLimitSeconds": 1800,
  "attemptNumber": 1
}
```

The `correct` flag is stripped from all options before returning — scoring happens server-side on submit.

### Errors

| HTTP | Meaning |
|------|---------|
| 401 | Not authenticated |
| 403 | Not a learner; OR modules not complete; OR in cooldown window; OR max attempts reached |
| 409 | Active attempt already in progress (returns `{ attemptId }` of the existing attempt) |
| 500 | No exam questions available in DB |

### Eligibility checks (server-side)
1. All 5 modules have all lessons `complete` (verified from DB, not client).
2. No currently active (unsubmitted, not-expired) attempt exists.
3. Last failed attempt must be >24h old.
4. Total submitted attempts < 3.

### Exam auto-submit
The `exam-timeout-sweep` cron (every minute) auto-submits attempts where `started_at + time_limit_seconds + 30s < now()`. If the learner abandons the browser, the cron catches it.

---

## POST /api/exam/submit

### Purpose
Submits exam answers, computes score, issues certificate on pass.

### Auth
Learner session required.

### Request

```json
{
  "attemptId": "uuid",
  "answers": {
    "question-uuid-1": "option-uuid-A",
    "question-uuid-2": "option-uuid-D"
  }
}
```

`answers` is a map of `questionId → chosenOptionId`. Max 25 entries; excess are ignored.

### Response — 200 OK

```json
{
  "passed": true,
  "scorePercent": 88,
  "certCode": "AW-2026-000001",
  "retryAvailableAt": null
}
```

On fail: `certCode` is omitted; `retryAvailableAt` is an ISO string if in cooldown, or `null` if max attempts reached.  
On time-expired submission: returns `{ passed: false, scorePercent: 0, error: "Time limit exceeded" }`.

### Errors

| HTTP | Meaning |
|------|---------|
| 400 | Validation failed |
| 401 | Not authenticated |
| 403 | Not your attempt |
| 404 | Attempt not found |
| 409 | Attempt already submitted |

### Scoring
- Score = `(correctAnswers / 25) × 100` — denominator is always 25.
- Pass threshold: ≥80%.
- Questions not in the `answers` map count as wrong.
- Client cannot inject more than 25 answers (server caps at 25).

### On pass side effects
1. Inserts `certificates` row: `cert_code = AW-{year}-{seq}`, `expires_at = issued_at + 12 months`.
2. Fire-and-forget: `POST /api/certs/generate` to render the PDF.
3. Inserts `activity_events`: `type='exam_passed'`.
4. Sends `ExamPassed` email to the restaurant admin.

---

## lib/learner/progress.ts

Key exports:
- `isLessonLocked(moduleOrderIndex, allModules, lessonsPerModule, progressMap)` — returns true if the lesson's module prerequisites aren't met.
- `areAllModulesComplete(moduleIds, lessonsPerModule, progressMap)` — returns true when every lesson in every module is `complete`.
- `deriveModuleStatus(mod, lessonIds, progressMap, allModules, lessonsPerModule)` — returns `{ status, completedCount, totalCount }`.
- `isWatchedSecondsPlausible(watchedSeconds, startedAt)` — anti-cheat wall-clock check.

## lib/learner/exam.ts

Key exports:
- `scoreExam(questions, answers)` — pure scoring function.
- `isAttemptExpired(attempt, nowMs)` — returns true if beyond time limit + grace.
- `isAttemptActive(attempt, nowMs)` — returns true if unsubmitted and not expired.
- `checkCooldown(pastAttempts, nowMs)` — returns `{ canAttempt, reason, retryAvailableAt, attemptNumber }`.
- `findActiveAttempt(attempts, nowMs)` — returns the active attempt or null.
- `buildCertCode(year, sequence)` — generates `AW-{year}-{zero-padded-6-seq}`.

## lib/learner/cert.ts

Key exports:
- `getCertStatus(cert, nowMs)` — returns `'valid' | 'expired' | 'revoked'`.
- `isCertActive(cert, nowMs)` — returns true only for valid certs.
- `canCertTransition(from, to)` — state machine guard.
- `canIssueCertForLearner(existingCerts, nowMs)` — blocks if learner has an active cert.
- `daysUntilExpiry(cert, nowMs)` — days until expiry (negative if past).
