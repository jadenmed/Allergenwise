import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/ui/Button";
import PortalShell from "../components/portal/PortalShell";
import { getLearnerHome, ApiError } from "../lib/api";

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

function LockIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" />
    </svg>
  );
}

const primaryDark = "bg-teal-900 hover:bg-teal-950";

function firstIncompleteLesson(module) {
  return module.lessons.find((l) => l.status !== "complete") ?? module.lessons[0];
}

export default function StaffCourse() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getLearnerHome()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Failed to load your course."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <PortalShell activeNav="course">
        <p className="text-base text-grey-600">Loading your course&hellip;</p>
      </PortalShell>
    );
  }

  if (error || !data) {
    return (
      <PortalShell activeNav="course">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error || "Something went wrong."}
        </p>
      </PortalShell>
    );
  }

  const { modules, certificate } = data;
  const currentModule = modules.find((m) => m.status === "in_progress");
  const upNextModule =
    !currentModule ? modules.find((m) => m.status === "not_started") : null;
  const activeModule = currentModule || upNextModule;
  const completedModules = modules.filter((m) => m.status === "complete");
  const lockedModules = modules.filter((m) => m.status === "locked");

  const resumeLesson = activeModule ? firstIncompleteLesson(activeModule) : null;
  const goToLesson = (lessonId) => navigate(`/portal/course/lesson/${lessonId}`);

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
        {resumeLesson && (
          <Button
            variant="primary"
            size="sm"
            className={primaryDark}
            onClick={() => goToLesson(resumeLesson.id)}
          >
            Continue
          </Button>
        )}
      </div>

      {activeModule && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-950">
            {currentModule ? "In progress" : "Up next"} &middot; 1
          </p>

          <div className="rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-6">
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center size-11 rounded-lg bg-teal-050 text-teal-700 shrink-0">
                <SpinnerIcon className="size-5" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold text-teal-950">
                  {activeModule.title}
                </p>
                <p className="text-base text-grey-600">
                  {activeModule.totalCount} lesson
                  {activeModule.totalCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-base text-grey-600">
                <span className="font-semibold text-teal-950">
                  {Math.round(
                    (activeModule.completedCount / activeModule.totalCount) * 100
                  )}
                  % complete
                </span>
                <span className="text-grey-400">&middot;</span>
                Module {activeModule.orderIndex} of {modules.length}
              </p>
              <div className="h-2 w-full rounded-full bg-grey-300 overflow-hidden">
                <div
                  className="h-full rounded-full bg-teal-700"
                  style={{
                    width: `${
                      (activeModule.completedCount / activeModule.totalCount) * 100
                    }%`,
                  }}
                />
              </div>
            </div>

            {resumeLesson && (
              <Button
                variant="primary"
                size="sm"
                className={`w-fit ${primaryDark}`}
                onClick={() => goToLesson(resumeLesson.id)}
              >
                {currentModule ? "Continue from" : "Start"} Lesson{" "}
                {activeModule.orderIndex}.{resumeLesson.orderIndex} &rarr;
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-teal-950">
          Completed &middot; {completedModules.length}
        </p>

        {certificate && (
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
                    {certificate.certCode}
                  </p>
                </div>
              </div>
              <span className="inline-flex shrink-0 rounded px-3.5 py-2 text-xs font-bold uppercase tracking-wide bg-green-100 text-green-700">
                Active
              </span>
            </div>

            <p className="flex items-center gap-2 text-base text-grey-600">
              Issued {new Date(certificate.issuedAt).toLocaleDateString()}
              <span className="text-grey-400">&middot;</span>
              Expires {new Date(certificate.expiresAt).toLocaleDateString()}
            </p>

            {certificate.pdfUrl && (
              <div className="flex items-center gap-3">
                <a href={certificate.pdfUrl} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm">
                    Download certificate
                  </Button>
                </a>
              </div>
            )}
          </div>
        )}

        {completedModules.map((mod) => (
          <div
            key={mod.id}
            className="rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center size-11 rounded-lg bg-teal-050 text-teal-700 shrink-0">
                <ShieldCheckIcon className="size-5" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold text-teal-950">
                  {mod.title}
                </p>
                <p className="text-base text-grey-600">
                  {mod.totalCount} lessons
                </p>
              </div>
            </div>
            <span className="inline-flex shrink-0 rounded px-3.5 py-2 text-xs font-bold uppercase tracking-wide bg-green-100 text-green-700">
              Completed
            </span>
          </div>
        ))}

        {!certificate && completedModules.length === 0 && (
          <p className="text-base text-grey-500">
            Nothing completed yet &mdash; keep going!
          </p>
        )}
      </div>

      {lockedModules.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-950">
            Locked &middot; {lockedModules.length}
          </p>

          <div className="rounded-2xl border border-grey-300 bg-white divide-y divide-grey-300">
            {lockedModules.map((mod) => (
              <div
                key={mod.id}
                className="flex items-center gap-4 p-6 sm:p-8"
              >
                <div className="flex items-center justify-center size-11 rounded-lg bg-grey-100 text-grey-500 shrink-0">
                  <LockIcon className="size-5" />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-lg font-semibold text-teal-950">
                    {mod.title}
                  </p>
                  <p className="text-base text-grey-500">
                    {mod.totalCount} lessons &middot; Locked until the
                    previous module is complete
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </PortalShell>
  );
}
