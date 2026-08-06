import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import SectionCard from "../components/ui/SectionCard";
import ReviewerShell from "../components/reviewer/ReviewerShell";

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

export const SUBMISSIONS = [
  {
    id: "the-copper-spoon",
    restaurant: "The Copper Spoon",
    city: "Portland, OR",
    received: "Aug 4, 2026",
    status: "inReview",
  },
  {
    id: "harbor-and-hearth",
    restaurant: "Harbor & Hearth",
    city: "Seattle, WA",
    received: "Aug 3, 2026",
    status: "pending",
  },
  {
    id: "maple-and-vine",
    restaurant: "Maple & Vine",
    city: "Eugene, OR",
    received: "Aug 1, 2026",
    status: "infoRequested",
  },
  {
    id: "the-tin-roof",
    restaurant: "The Tin Roof",
    city: "Bend, OR",
    received: "Jul 29, 2026",
    status: "approved",
  },
  {
    id: "salt-and-sage",
    restaurant: "Salt & Sage",
    city: "Tacoma, WA",
    received: "Jul 27, 2026",
    status: "rejected",
  },
  {
    id: "riverside-provisions",
    restaurant: "Riverside Provisions",
    city: "Vancouver, WA",
    received: "Jul 25, 2026",
    status: "pending",
  },
];

const STATUS_CONFIG = {
  pending: { label: "Pending", dot: "bg-grey-400", text: "text-grey-600" },
  inReview: { label: "In review", dot: "bg-teal-700", text: "text-teal-700" },
  infoRequested: { label: "Info requested", dot: "bg-yellow-700", text: "text-yellow-700" },
  approved: { label: "Approved", dot: "bg-green-700", text: "text-green-700" },
  rejected: { label: "Rejected", dot: "bg-red-600", text: "text-red-700" },
};

export default function SubmissionQueue() {
  return (
    <ReviewerShell activeNav="submissions">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            Submission queue
          </h1>
          <p className="text-base text-grey-600">
            {SUBMISSIONS.length} restaurant submissions awaiting review.
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
          placeholder="Restaurant, city, etc..."
          className="w-full rounded-lg border border-grey-300 bg-white pl-11 pr-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
        />
      </div>

      <SectionCard title="Submissions">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="bg-teal-050">
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Restaurant
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  City
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
              {SUBMISSIONS.map((s) => {
                const config = STATUS_CONFIG[s.status];
                return (
                  <tr key={s.id} className="border-t border-grey-300">
                    <td className="px-3 py-3 text-base text-teal-950 whitespace-nowrap">
                      {s.restaurant}
                    </td>
                    <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                      {s.city}
                    </td>
                    <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                      {s.received}
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
                      <Link
                        to={`/internal/submissions/${s.id}`}
                        className="text-sm font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </ReviewerShell>
  );
}
