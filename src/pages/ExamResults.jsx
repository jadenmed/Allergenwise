import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import Button from "../components/ui/Button";
import checkFatGreen from "../assets/check-fat-green.svg";
import linkedin from "../assets/linkedin.svg";

const RESULT = {
  scorePercent: 92,
  correctCount: 23,
  totalCount: 25,
  passThreshold: 80,
  restaurantName: "The Garden Table",
  credentialId: "AW-PDX-8FQ2-K9-02",
  name: "Daniel Kim",
  role: "Head Chef",
  issued: "May 30, 2026",
  validThrough: "May 30, 2027",
  badgeQr: "AW-DK-7H4M",
};

function DownloadIcon({ className = "" }) {
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
      <path d="M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5" />
      <path d="M3.5 15.5v1a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

function QrIcon({ className = "" }) {
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
      <rect x="3" y="3" width="5" height="5" rx="0.75" />
      <rect x="12" y="3" width="5" height="5" rx="0.75" />
      <rect x="3" y="12" width="5" height="5" rx="0.75" />
      <path d="M12.5 12.5h2m2.5 0h-.01M12.5 16.5h2m2.5-2v2" />
    </svg>
  );
}

export default function ExamResults() {
  const {
    scorePercent,
    correctCount,
    totalCount,
    passThreshold,
    restaurantName,
    credentialId,
    name,
    role,
    issued,
    validThrough,
    badgeQr,
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
          <Link to="/dashboard">
            <Button size="sm">Open dashboard</Button>
          </Link>
        </div>
      </header>

      <main className="w-full flex flex-col items-center px-4 sm:px-6 lg:px-12 py-14">
        <div className="w-full max-w-[760px] flex flex-col items-center gap-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex items-center justify-center size-28 rounded-full bg-green-100">
              <img src={checkFatGreen} alt="" className="size-12" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
                You passed
              </p>
              <h1 className="font-serif font-semibold text-4xl leading-tight text-teal-950">
                Certification Earned
              </h1>
              <p className="font-serif font-semibold text-6xl leading-none text-green-700">
                {scorePercent}%
              </p>
            </div>
            <p className="text-base leading-6 text-grey-600 max-w-[520px]">
              {correctCount} of {totalCount} correct &middot; {passThreshold}%
              required to pass. Your individual credential has been issued
              and added to {restaurantName}'s verification record.
            </p>
          </div>

          <div className="w-full rounded-2xl border border-grey-300 bg-white overflow-hidden">
            <div className="h-2 w-full bg-teal-700" />
            <div className="flex flex-col gap-6 p-6 sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <Logo />
                <p className="text-base text-grey-600">{credentialId}</p>
              </div>

              <div className="flex flex-col gap-1 border-t border-grey-300 pt-6">
                <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
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
                    Issued
                  </p>
                  <p className="text-base font-semibold text-teal-950">{issued}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                    Valid through
                  </p>
                  <p className="text-base font-semibold text-teal-950">
                    {validThrough}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                    Score
                  </p>
                  <p className="text-base font-semibold text-teal-950">
                    {scorePercent}% &middot; Pass
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                    Badge QR
                  </p>
                  <p className="text-base font-semibold text-teal-950">{badgeQr}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button icon={undefined} className="gap-2">
              <DownloadIcon className="size-5" />
              Download certificate
            </Button>
            <Button variant="outline" className="gap-2">
              <QrIcon className="size-5" />
              Print badge QR
            </Button>
            <Button variant="outline" className="gap-2">
              <img src={linkedin} alt="" className="size-5" />
              Share on LinkedIn
            </Button>
          </div>

          <div className="flex flex-col items-center gap-1 border-t border-grey-300 pt-6 w-full text-center">
            <p className="text-sm text-grey-600">
              Your credential is now active in the AllergenWise registry.
            </p>
            <Link
              to="/course"
              className="text-sm font-semibold text-teal-700 hover:text-teal-800"
            >
              View it in your dashboard &rarr;
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
