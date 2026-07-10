import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import Button from "../components/ui/Button";

const RESULT = {
  scorePercent: 64,
  passThreshold: 80,
  credentialId: "AW-PDX-8FQ2-K9-02",
  activeThrough: "Jun 22, 2026",
  attempt: 1,
  attemptsTotal: 3,
  retakesLeft: 2,
  nextAttempt: "Available in 24 hours",
};

const MODULES = [
  { name: "Module 1 \u00b7 The major allergens", correct: 9, total: 9, percent: 100, passed: true },
  { name: "Module 2 \u00b7 Cross-contact & the kitchen", correct: 7, total: 9, percent: 78, passed: true },
  { name: "Module 3 \u00b7 Front-of-house", correct: 9, total: 9, percent: 15, passed: false },
  { name: "Module 4 \u00b7 Cleaning & sourcing", correct: 9, total: 9, percent: 15, passed: false },
  { name: "Module 5 \u00b7 Emergency response", correct: 9, total: 9, percent: 15, passed: false },
];

const REVIEW_MODULES = [
  "Module 3 \u00b7 Front-of-house",
  "Module 4 \u00b7 Cleaning & sourcing",
];

function CloseIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 5l10 10M15 5 5 15" />
    </svg>
  );
}

export default function ExamResultsFailed() {
  const {
    scorePercent,
    passThreshold,
    credentialId,
    activeThrough,
    attempt,
    attemptsTotal,
    retakesLeft,
    nextAttempt,
  } = RESULT;

  return (
    <div className="w-full min-h-screen flex flex-col bg-grey-100">
      <header className="w-full flex items-center justify-between gap-4 border-b border-grey-300 bg-white px-4 sm:px-6 py-4">
        <div className="flex items-center gap-4 min-w-0">
          <Logo className="shrink-0" />
          <div className="hidden sm:block h-6 w-px bg-grey-300 shrink-0" />
          <p className="hidden sm:block text-sm text-grey-600 truncate">
            Allergen Safety Certification Exam &middot; Proctored session
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link to="/course">
            <Button variant="outline" size="sm">
              Back to course
            </Button>
          </Link>
          <Button size="sm">Open dashboard</Button>
        </div>
      </header>

      <main className="w-full flex flex-col items-center px-4 sm:px-6 lg:px-12 py-14">
        <div className="w-full max-w-[760px] flex flex-col items-center gap-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex items-center justify-center size-28 rounded-full bg-red-100">
              <CloseIcon className="size-12 text-red-700" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-red-700">
                Did not pass
              </p>
              <h1 className="font-serif font-semibold text-4xl leading-tight text-teal-950">
                Certification Not Earned
              </h1>
              <p className="font-serif font-semibold text-6xl leading-none text-red-700">
                {scorePercent}%
              </p>
            </div>
            <p className="text-base leading-6 text-grey-600 max-w-[520px]">
              You scored {scorePercent}% &mdash; {passThreshold}% is required
              to pass. Your current credential is still valid through{" "}
              {activeThrough}.
            </p>
          </div>

          <div className="w-full rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-6">
            <p className="text-xs font-bold uppercase tracking-wide text-red-700">
              Where you lost points
            </p>
            <div className="flex flex-col gap-5">
              {MODULES.map((mod) => (
                <div
                  key={mod.name}
                  className="flex items-center justify-between gap-4"
                >
                  <p className="text-base text-teal-950 w-full max-w-[260px] shrink-0">
                    {mod.name}
                  </p>
                  <div className="flex-1 h-1.5 rounded-full bg-grey-200 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        mod.passed ? "bg-green-700" : "bg-red-700"
                      }`}
                      style={{ width: `${mod.percent}%` }}
                    />
                  </div>
                  <p
                    className={`text-sm font-semibold shrink-0 w-12 text-right ${
                      mod.passed ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {mod.correct} / {mod.total}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="w-full rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-4">
            <p className="text-xs font-bold uppercase tracking-wide text-red-700">
              Recommended review before retake
            </p>
            <div className="flex flex-col">
              {REVIEW_MODULES.map((mod, index) => (
                <div
                  key={mod}
                  className={`py-3 ${
                    index !== 0 ? "border-t border-grey-300" : "pt-0"
                  }`}
                >
                  <p className="text-base text-teal-950">{mod}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="w-full rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 grid grid-cols-2 gap-x-6 gap-y-5">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                Attempt
              </p>
              <p className="text-base font-semibold text-teal-950">
                {attempt} of {attemptsTotal}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                Retakes left
              </p>
              <p className="text-base font-semibold text-teal-950">
                {retakesLeft}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                Next attempt
              </p>
              <p className="text-base font-semibold text-teal-950">
                {nextAttempt}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                Current credential
              </p>
              <p className="text-base font-semibold text-teal-950">
                Valid through {activeThrough.replace(", 2026", "")}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-1 border-t border-grey-300 pt-6 w-full text-center">
            <p className="text-sm text-grey-600 max-w-[520px]">
              <span className="font-semibold text-teal-950">
                Your current credential is unaffected for now.
              </span>{" "}
              {credentialId} stays active through {activeThrough}. If you
              don't pass before then, the credential lapses.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
