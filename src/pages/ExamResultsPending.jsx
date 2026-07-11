import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import Button from "../components/ui/Button";

const REVIEW = {
  scorePercent: 88,
  restaurantName: "The Garden Table",
  credentialId: "AW-PDX-8FQ2-K9-02",
  name: "Daniel Kim",
  role: "Head Chef",
  submitted: "May 30, 2026",
  expectedBy: "May 31, 2026 · ~14 hrs",
  activeThrough: "Jun 22, 2026",
};

const FLAGS = [
  {
    icon: "camera",
    title: "Camera angle shifted mid-session",
    body: "Between Q14 and Q15, your camera was repositioned by ~30\u00b0. Sometimes it's a chair adjustment \u2014 sometimes it's a sign of off-frame help.",
  },
  {
    icon: "clock",
    title: "Estimated review time",
    body: "4\u201324 hours. You'll receive an email and a dashboard notification the moment the review completes.",
  },
  {
    icon: "flag",
    title: "What happens next",
    body: "If your session is confirmed clean, the credential issues automatically \u2014 no extra steps. If not, you're invited to retake under stricter proctoring at no charge.",
  },
];

function SparkleIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" />
    </svg>
  );
}

function CameraIcon({ className = "" }) {
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
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h7A1.5 1.5 0 0 1 13 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-7Z" />
      <path d="M13 8.5 17 6v8l-4-2.5" />
    </svg>
  );
}

function ClockIcon({ className = "" }) {
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
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4l2.5 2.5" />
    </svg>
  );
}

function FlagIcon({ className = "" }) {
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
      <path d="M4.5 2.5v15M4.5 3.5h9l-2 3 2 3h-9" />
    </svg>
  );
}

const FLAG_ICONS = { camera: CameraIcon, clock: ClockIcon, flag: FlagIcon };

export default function ExamResultsPending() {
  const {
    scorePercent,
    restaurantName,
    credentialId,
    name,
    role,
    submitted,
    expectedBy,
    activeThrough,
  } = REVIEW;

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
          <Link to="/dashboard">
            <Button size="sm">Open dashboard</Button>
          </Link>
        </div>
      </header>

      <main className="w-full flex flex-col items-center px-4 sm:px-6 lg:px-12 py-14">
        <div className="w-full max-w-[760px] flex flex-col items-center gap-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex items-center justify-center size-28 rounded-full bg-yellow-100">
              <SparkleIcon className="size-12 text-yellow-700" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-yellow-700">
                Awaiting human review
              </p>
              <h1 className="font-serif font-semibold text-4xl leading-tight text-teal-950">
                Your Exam is Under Review
              </h1>
              <p className="font-serif font-semibold text-6xl leading-none text-yellow-700">
                {scorePercent}%
              </p>
            </div>
            <p className="text-base leading-6 text-grey-600 max-w-[540px]">
              Your provisional score is {scorePercent}% &mdash; which would
              pass &mdash; but our proctoring system flagged a pattern in
              your session for a human reviewer to confirm before your
              credential issues. Most reviews complete within 4&ndash;24
              hours.
            </p>
          </div>

          <div className="w-full rounded-2xl border border-grey-300 bg-white overflow-hidden">
            <div className="h-2 w-full bg-yellow-700" />
            <div className="flex flex-col gap-6 p-6 sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <Logo />
                <p className="text-base text-grey-600">
                  {credentialId} &middot; pending
                </p>
              </div>

              <div className="flex flex-col gap-1 border-t border-grey-300 pt-6">
                <p className="text-xs font-bold uppercase tracking-wide text-yellow-700">
                  Allergen safety certification
                </p>
                <h2 className="font-serif font-semibold text-2xl text-teal-950">
                  {name}
                </h2>
                <p className="text-base text-grey-600">
                  {role} &middot; {restaurantName}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-grey-300 pt-6">
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                    Provisional score
                  </p>
                  <p className="text-base font-semibold text-yellow-700">
                    {scorePercent}% &middot; pending
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                    Review status
                  </p>
                  <p className="text-base font-semibold text-yellow-700">
                    Under review
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                    Submitted
                  </p>
                  <p className="text-base font-semibold text-teal-950">
                    {submitted}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                    Expected by
                  </p>
                  <p className="text-base font-semibold text-teal-950">
                    {expectedBy}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-5">
            <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
              What we flagged
            </p>
            <div className="flex flex-col">
              {FLAGS.map((flag, index) => {
                const Icon = FLAG_ICONS[flag.icon];
                return (
                  <div
                    key={flag.title}
                    className={`flex items-start gap-3 py-4 ${
                      index !== 0 ? "border-t border-grey-300" : "pt-0"
                    }`}
                  >
                    <Icon className="size-5 text-yellow-700 shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-1">
                      <p className="text-base font-semibold text-teal-950">
                        {flag.title}
                      </p>
                      <p className="text-sm leading-5 text-grey-600">
                        {flag.body}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col items-center gap-1 border-t border-grey-300 pt-6 w-full text-center">
            <p className="text-sm text-grey-600">
              <span className="font-semibold text-teal-950">
                Your current credential is unaffected.
              </span>{" "}
              {credentialId} remains active through {activeThrough}.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
