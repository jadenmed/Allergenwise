/**
 * tests/unit/account-export-shape.test.ts
 *
 * P1-16 — export JSON shape conforms to the documented schema and
 * empty arrays appear for missing sections rather than being absent.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildAccountExport } from '@/lib/account/export';

interface ExportFixture {
  profile: Record<string, unknown> | null;
  certificates: Record<string, unknown>[];
  examAttempts: Record<string, unknown>[];
  lessonProgress: Record<string, unknown>[];
  invitesSent: Record<string, unknown>[];
  activityEvents: Record<string, unknown>[];
}

function makeDb(fixture: ExportFixture): Parameters<typeof buildAccountExport>[0] {
  // We must distinguish two calls to `db.from('profiles')`: the first
  // resolves the subject (via `.single()`) and the second resolves
  // invitesSent (awaited directly on `.eq(...)`).
  let profilesCall = 0;
  const fromImpl = (table: string) => {
    if (table === 'profiles') {
      profilesCall++;
      const isInvitesSentCall = profilesCall > 1;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      if (isInvitesSentCall) {
        chain.eq = () => Promise.resolve({ data: fixture.invitesSent, error: null });
      } else {
        chain.eq = () => ({
          single: vi.fn().mockResolvedValue({ data: fixture.profile, error: null }),
        });
      }
      return chain;
    }
    const dataFor = (t: string) => {
      switch (t) {
        case 'certificates':
          return fixture.certificates;
        case 'exam_attempts':
          return fixture.examAttempts;
        case 'lesson_progress':
          return fixture.lessonProgress;
        case 'activity_events':
          return fixture.activityEvents;
        default:
          return [];
      }
    };
    return {
      select: () => ({
        eq: () => Promise.resolve({ data: dataFor(table), error: null }),
      }),
    };
  };
  return { from: fromImpl } as unknown as Parameters<typeof buildAccountExport>[0];
}

describe('buildAccountExport', () => {
  const PROFILE = 'p-1';

  it('returns the documented top-level keys + schema block', async () => {
    const db = makeDb({
      profile: {
        id: PROFILE,
        full_name: 'Jane',
        email: 'jane@x.test',
        role: 'manager',
        invited_at: '2026-01-01T00:00:00Z',
        invited_by: 'p-0',
        accepted_at: '2026-01-02T00:00:00Z',
      },
      certificates: [{ cert_code: 'AW-1' }],
      examAttempts: [],
      lessonProgress: [{ lesson_id: 'l-1', status: 'complete' }],
      invitesSent: [{ id: 'inv-1', email: 'b@x.test' }],
      activityEvents: [],
    });

    const out = await buildAccountExport(db, PROFILE);
    expect(out.schema.version).toBe(1);
    expect(out.schema.subject.profileId).toBe(PROFILE);
    expect(out.schema.subject.email).toBe('jane@x.test');
    expect(out.schema.fields).toHaveProperty('certificates');
    expect(out.schema.fields).toHaveProperty('examAttempts');
    expect(out.profile).toBeTruthy();
    expect(out.certificates).toHaveLength(1);
    expect(out.examAttempts).toEqual([]);
    expect(out.lessonProgress).toHaveLength(1);
    expect(out.invitesSent).toHaveLength(1);
    expect(out.invitesReceived).toHaveLength(1);
    expect(Array.isArray(out.activityEvents)).toBe(true);
  });

  it('invitesReceived is empty when subject was not invited', async () => {
    const db = makeDb({
      profile: {
        id: PROFILE,
        full_name: 'NeverInvited',
        email: 'n@x.test',
        role: 'manager',
        invited_at: null,
        invited_by: null,
        accepted_at: null,
      },
      certificates: [],
      examAttempts: [],
      lessonProgress: [],
      invitesSent: [],
      activityEvents: [],
    });
    const out = await buildAccountExport(db, PROFILE);
    expect(out.invitesReceived).toEqual([]);
  });
});
