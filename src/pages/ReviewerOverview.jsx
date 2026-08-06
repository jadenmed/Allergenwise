import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import SectionCard from "../components/ui/SectionCard";
import ReviewerShell, { REVIEWER } from "../components/reviewer/ReviewerShell";

const STATS = [
  { label: "Submissions in queue", value: "14", caption: "3 need info" },
  {
    label: "Decisions this week",
    value: "22",
    caption: "18 approved \u00b7 4 rejected",
  },
  {
    label: "Median review time",
    value: "1.8 hrs",
    caption: "\u2193 12% vs last week",
    captionTone: "green",
  },
];

const NEEDS_ATTENTION = [
  {
    key: "copper-spoon",
    name: "The Copper Spoon",
    type: "Submission",
    detail: "Waiting 2 days \u00b7 info requested",
    action: "Open",
    to: "/internal/submissions/the-copper-spoon",
  },
  {
    key: "daniel-kim",
    name: "Daniel Kim",
    type: "Certification",
    detail: "The Garden Table \u00b7 flagged for review",
    action: "Open",
    to: "/internal/certifications",
  },
  {
    key: "hannah-tran",
    name: "Hannah Tran",
    type: "Certification",
    detail: "The Garden Table \u00b7 needs follow up",
    action: "Follow up",
    to: "/internal/certifications",
  },
];

export default function ReviewerOverview() {
  return (
    <ReviewerShell activeNav="overview">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            Reviewer overview
          </h1>
          <p className="text-base text-grey-600">
            Welcome back, {REVIEWER.name.split(" ")[0]}. Here&apos;s what needs
            attention today.
          </p>
        </div>
        <Link to="/internal/submissions">
          <Button variant="primary" size="sm">
            Open queue
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col gap-2 rounded-2xl border border-grey-300 bg-white p-5"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              {stat.label}
            </p>
            <p className="font-serif font-semibold text-3xl text-teal-950">
              {stat.value}
            </p>
            <p
              className={`text-sm ${
                stat.captionTone === "green" ? "text-green-700" : "text-grey-500"
              }`}
            >
              {stat.caption}
            </p>
          </div>
        ))}
      </div>

      <SectionCard title="Needs your attention">
        <div className="flex flex-col">
          {NEEDS_ATTENTION.map((item, i) => (
            <div
              key={item.key}
              className={`flex items-center justify-between gap-4 py-4 ${
                i > 0 ? "border-t border-grey-300" : ""
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <p className="text-base font-semibold text-teal-950">
                  {item.name}
                </p>
                <p className="text-sm text-grey-500">
                  {item.type} &middot; {item.detail}
                </p>
              </div>
              <Link
                to={item.to}
                className="text-sm font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap"
              >
                {item.action}
              </Link>
            </div>
          ))}
        </div>
      </SectionCard>
    </ReviewerShell>
  );
}
