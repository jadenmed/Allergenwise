/**
 * tests/unit/directory-card-cert-percent.test.tsx
 *
 * DirectoryCard carried a byte-identical copy of the detail page's defect:
 *
 *     totalEmployees > 0 ? Math.round((certifiedCount / totalEmployees) * 100) : 100
 *
 * rendered as "100% staff certified" on the public /directory list page for any
 * restaurant with a zero or unknown denominator.
 *
 * The card is fed by /api/search, which computes both counts in SQL, so it has
 * no partial-failure path of its own — but it shares the derivation helper, and
 * the unknown case is asserted here so the two surfaces cannot drift.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));

import { DirectoryCard, type DirectoryCardData } from '@/components/directory/DirectoryCard';

function card(overrides: Partial<DirectoryCardData>): string {
  const data: DirectoryCardData = {
    slug: 'bellas-kitchen',
    name: "Bella's Kitchen",
    cuisine: 'Italian',
    city: 'Austin',
    state: 'TX',
    allergenSpecialties: ['peanut'],
    certifiedCount: 0,
    totalEmployees: 0,
    distanceMi: null,
    avgRating: null,
    reviewCount: 0,
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(DirectoryCard, { restaurant: data }));
}

describe('DirectoryCard — normal path', () => {
  it('renders the real percentage and the ratio tooltip', () => {
    const html = card({ certifiedCount: 3, totalEmployees: 4 });

    expect(html).toContain('75%');
    expect(html).toContain('title="3 of 4 staff certified"');
  });

  it('renders 100% only when every learner is certified', () => {
    const html = card({ certifiedCount: 4, totalEmployees: 4 });
    expect(html).toContain('100%');
    expect(html).toContain('title="4 of 4 staff certified"');
  });

  it('renders 0% for a genuine zero over a real denominator', () => {
    const html = card({ certifiedCount: 0, totalEmployees: 4 });
    expect(html).toContain('0%');
    expect(html).not.toContain('100%');
  });
});

describe('DirectoryCard — totalEmployees=0 with the query succeeding', () => {
  it('never renders 100%', () => {
    const html = card({ certifiedCount: 0, totalEmployees: 0 });

    expect(html).not.toContain('100%');
    expect(html).not.toMatch(/\d+%/);
  });

  it('renders the explicit no-learners state instead of a percentage', () => {
    const html = card({ certifiedCount: 0, totalEmployees: 0 });

    expect(html).toContain('No staff enrolled yet');
    expect(html).not.toContain('staff certified');
  });

  it('drops the misleading "0 of 0" tooltip', () => {
    const html = card({ certifiedCount: 0, totalEmployees: 0 });
    expect(html).not.toContain('title="0 of 0 staff certified"');
  });

  it('still renders the rest of the card', () => {
    const html = card({ certifiedCount: 0, totalEmployees: 0 });

    expect(html).toContain('Bella&#x27;s Kitchen');
    expect(html).toContain('Italian');
    expect(html).toContain('Austin, TX');
  });
});

describe('DirectoryCard — all-manager restaurant', () => {
  it('never renders 100% when certificates exist but no learners do', () => {
    const html = card({ certifiedCount: 2, totalEmployees: 0 });

    expect(html).not.toContain('100%');
    expect(html).not.toMatch(/\d+%/);
  });

  it('states the headcount without implying a ratio', () => {
    const html = card({ certifiedCount: 2, totalEmployees: 0 });
    expect(html).toContain('2 certified staff members');
  });

  it('singularises a lone certified staff member', () => {
    const html = card({ certifiedCount: 1, totalEmployees: 0 });

    expect(html).toContain('1 certified staff member');
    expect(html).not.toContain('1 certified staff members');
  });
});

describe('DirectoryCard — unknown counts', () => {
  it('never renders a percentage when a count is null', () => {
    const html = card({ certifiedCount: null, totalEmployees: null });

    expect(html).not.toMatch(/\d+%/);
    expect(html).toContain('Certification data unavailable');
  });

  it('keeps unknown distinct from no-learners', () => {
    const unknown = card({ certifiedCount: null, totalEmployees: null });
    const noLearners = card({ certifiedCount: 0, totalEmployees: 0 });

    expect(unknown).toContain('Certification data unavailable');
    expect(unknown).not.toContain('No staff enrolled yet');

    expect(noLearners).toContain('No staff enrolled yet');
    expect(noLearners).not.toContain('Certification data unavailable');
  });
});
