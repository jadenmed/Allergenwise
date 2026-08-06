import Button from "../components/ui/Button";
import PortalShell from "../components/portal/PortalShell";

function SpinnerIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.3 5.3l2.1 2.1M12.6 12.6l2.1 2.1M5.3 14.7l2.1-2.1M12.6 7.4l2.1-2.1" />
    </svg>
  );
}

function ShieldCheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 2.5 16 5v5c0 4-2.6 6.5-6 7.5-3.4-1-6-3.5-6-7.5V5z" />
      <path d="M7.3 10 9.3 12l3.4-4" />
    </svg>
  );
}

function DocIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5.5 2.5h6l3 3v12h-9z" />
      <path d="M11 2.5v3.5h3.5" />
      <path d="M7.5 11h5M7.5 13.5h5" />
    </svg>
  );
}

const primaryDark = "bg-teal-900 hover:bg-teal-950";

export default function StaffCourse() {
  return (
    <PortalShell activeNav="course">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1 max-w-[640px]">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            My Course
          </h1>
          <p className="text-base text-grey-600">
            Your training history at AllergenWise. Active courses pick up
            where you left off; completed courses contribute to your
            credential.
          </p>
        </div>
        <Button variant="primary" size="sm" className={primaryDark}>
          Continue
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-teal-950">
          In progress &middot; 1
        </p>

        <div className="rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-6">
          <div className="flex items-start gap-4">
            <div className="flex items-center justify-center size-11 rounded-lg bg-teal-050 text-teal-700 shrink-0">
              <SpinnerIcon className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold text-teal-950">
                Allergen Safety Recertification
              </p>
              <p className="text-base text-grey-600">
                The big 9, labeling law, and where each hides on a menu
                &middot; 6 lessons
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-base text-grey-600">
              <span className="font-semibold text-teal-950">52% complete</span>
              <span className="text-grey-400">&middot;</span>
              Module 3 of 5
              <span className="text-grey-400">&middot;</span>
              ~1.4 hrs left
            </p>
            <div className="h-2 w-full rounded-full bg-grey-300 overflow-hidden">
              <div className="h-full rounded-full bg-teal-700" style={{ width: "52%" }} />
            </div>
          </div>

          <Button variant="primary" size="sm" className={`w-fit ${primaryDark}`}>
            Continue from Lesson 3.2 &rarr;
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-teal-950">
          Completed &middot; 1
        </p>

        <div className="rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center size-11 rounded-lg bg-teal-050 text-teal-700 shrink-0">
                <ShieldCheckIcon className="size-5" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold text-teal-950">
                  Allergen Safety Certification
                </p>
                <p className="text-base text-grey-600">
                  Original certification &middot; 5 modules &middot;
                  25-question exam
                </p>
              </div>
            </div>
            <span className="inline-flex shrink-0 rounded px-3.5 py-2 text-xs font-bold uppercase tracking-wide bg-green-100 text-green-700">
              Passed
            </span>
          </div>

          <p className="flex items-center gap-2 text-base text-grey-600">
            Original certification
            <span className="text-grey-400">&middot;</span>
            Completed Jun 22, 2025
            <span className="text-grey-400">&middot;</span>
            AW-PDX-8FQ2-K9-02
          </p>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm">
              View result
            </Button>
            <Button variant="outline" size="sm">
              Download certificate
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-teal-950">
          Available &middot; Optional
        </p>

        <div className="rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-6">
          <div className="flex items-start gap-4">
            <div className="flex items-center justify-center size-11 rounded-lg bg-grey-100 text-grey-500 shrink-0">
              <DocIcon className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold text-teal-950">
                Allergen Leadership for Managers
              </p>
              <p className="text-base text-grey-600">
                Advanced module for FOH / BOH leads. Cross-contact auditing,
                supplier interrogation, allergic-incident drills.
              </p>
            </div>
          </div>

          <p className="flex items-center gap-2 text-base text-grey-600">
            3 modules
            <span className="text-grey-400">&middot;</span>
            ~2 hrs
            <span className="text-grey-400">&middot;</span>
            Recommended for: Head Chef, Sous Chef, Manager
          </p>

          <Button variant="outline" size="sm" className="w-fit">
            Enroll
          </Button>
        </div>
      </div>
    </PortalShell>
  );
}
