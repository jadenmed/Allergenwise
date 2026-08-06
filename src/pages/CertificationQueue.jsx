import { useState } from "react";
import Button from "../components/ui/Button";
import SectionCard from "../components/ui/SectionCard";
import ReviewerShell from "../components/reviewer/ReviewerShell";
import CertificationReviewPanel from "../components/reviewer/CertificationReviewPanel";

function DownloadIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5" />
      <path d="M3.5 15.5v1a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

function SearchIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M16.5 16.5 13 13" />
    </svg>
  );
}

const CERTIFICATIONS = [
  {
    id: "daniel-kim",
    name: "Daniel Kim",
    restaurant: "The Garden Table",
    role: "Head Chef",
    score: 92,
    flags: 1,
    received: "Aug 5, 2026",
    status: "pendingReview",
    integrityChecks: [
      { label: "Face match to badge photo", status: "pass" },
      {
        label: "Single person detected throughout",
        status: "warn",
        note: "Second voice detected at 8:41",
      },
      { label: "No tab/window switching", status: "pass" },
      { label: "Continuous camera feed", status: "pass" },
    ],
    flaggedTimestamps: [
      { time: "2:14", label: "Looked away from camera" },
      { time: "8:41", label: "Second voice detected" },
    ],
  },
  {
    id: "hannah-tran",
    name: "Hannah Tran",
    restaurant: "The Garden Table",
    role: "Server",
    score: 88,
    flags: 0,
    received: "Aug 2, 2026",
    status: "approved",
    reviewedBy: "Viv",
    reviewedDate: "Aug 3, 2026",
    reasoning: "Clean recording, no integrity flags. Approved.",
  },
  {
    id: "jamal-carter",
    name: "Jamal Carter",
    restaurant: "The Garden Table",
    role: "Bartender",
    score: 79,
    flags: 2,
    received: "Jul 30, 2026",
    status: "rejected",
    reviewedBy: "Viv",
    reviewedDate: "Jul 31, 2026",
    reasoning:
      "Passed the score threshold, but two integrity flags (tab switching, second voice) could not be resolved with the staff member.",
    flaggedTimestamps: [
      { time: "4:02", label: "Tab switch detected" },
      { time: "11:20", label: "Second voice detected" },
    ],
  },
  {
    id: "amara-okafor",
    name: "Amara Okafor",
    restaurant: "The Garden Table",
    role: "Server",
    score: 95,
    flags: 0,
    received: "Jul 28, 2026",
    status: "approved",
    reviewedBy: "Viv",
    reviewedDate: "Jul 29, 2026",
    reasoning: "No flags. Approved.",
  },
];

const STATUS_CONFIG = {
  pendingReview: { label: "Pending review", dot: "bg-yellow-700", text: "text-yellow-700" },
  approved: { label: "Approved", dot: "bg-green-700", text: "text-green-700" },
  rejected: { label: "Rejected", dot: "bg-red-600", text: "text-red-700" },
};

export default function CertificationQueue() {
  const [selectedId, setSelectedId] = useState(null);
  const selected = CERTIFICATIONS.find((c) => c.id === selectedId) ?? null;

  return (
    <ReviewerShell activeNav="certifications">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            Certification queue
          </h1>
          <p className="text-base text-grey-600">
            {CERTIFICATIONS.length} staff exam results &middot; review flagged
            recordings before issuing credentials.
          </p>
        </div>
        <Button variant="outline" size="sm">
          <DownloadIcon className="size-4" />
          Export .CSV
        </Button>
      </div>

      <div className="relative w-full max-w-[560px]">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-grey-400" />
        <input
          type="text"
          placeholder="Name, restaurant, etc..."
          className="w-full rounded-lg border border-grey-300 bg-white pl-11 pr-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
        />
      </div>

      <SectionCard title="Exam results">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="bg-teal-050">
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Restaurant
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Role
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Score
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Flags
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Received
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Status
                </th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {CERTIFICATIONS.map((c) => {
                const config = STATUS_CONFIG[c.status];
                return (
                  <tr key={c.id} className="border-t border-grey-300">
                    <td className="px-3 py-3 whitespace-nowrap">
                      <p className="text-base text-teal-950">{c.name}</p>
                      <p className="text-sm text-grey-500">{c.restaurant}</p>
                    </td>
                    <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                      {c.role}
                    </td>
                    <td className="px-3 py-3 text-base font-semibold text-teal-950 whitespace-nowrap">
                      {c.score}%
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span
                        className={`text-sm font-semibold ${
                          c.flags > 0 ? "text-yellow-700" : "text-grey-400"
                        }`}
                      >
                        {c.flags > 0 ? `${c.flags} flag${c.flags > 1 ? "s" : ""}` : "None"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                      {c.received}
                    </td>
                    <td className="px-3 py-3">
                      <p
                        className={`flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap ${config.text}`}
                      >
                        <span className={`size-1.5 rounded-full ${config.dot}`} />
                        {config.label}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        className="text-sm font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <CertificationReviewPanel cert={selected} onClose={() => setSelectedId(null)} />
    </ReviewerShell>
  );
}
