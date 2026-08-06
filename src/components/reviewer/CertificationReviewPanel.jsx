import Button from "../ui/Button";

function ArrowLeftIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.5 4.5 6 11l6.5 6.5" />
    </svg>
  );
}

function CheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 10.5 8 14.5 16 5.5" />
    </svg>
  );
}

function WarningIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 2.5 18 17H2z" />
      <path d="M10 8v4M10 14.5v.01" />
    </svg>
  );
}

function PlayIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M6.5 4.5v11l9-5.5z" />
    </svg>
  );
}

function ScoreBox({ cert }) {
  return (
    <div className="rounded-lg border border-grey-300 p-4 flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <p className="text-xs text-grey-500">Exam score</p>
        <p className="font-serif font-semibold text-3xl text-teal-950">
          {cert.score}%
        </p>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <p className="text-xs text-grey-500">Flags</p>
        <p
          className={`text-base font-semibold ${
            cert.flags > 0 ? "text-yellow-700" : "text-green-700"
          }`}
        >
          {cert.flags > 0 ? `${cert.flags} flag${cert.flags > 1 ? "s" : ""}` : "None"}
        </p>
      </div>
    </div>
  );
}

function FacecamPlayer({ timestamps }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
        Facecam recording
      </p>
      <div className="relative flex items-center justify-center aspect-video rounded-lg bg-teal-950">
        <div className="flex items-center justify-center size-12 rounded-full bg-white/90 text-teal-900">
          <PlayIcon className="size-6" />
        </div>
        <p className="absolute bottom-3 right-3 text-xs font-semibold text-white/80">
          14:32
        </p>
      </div>
      {timestamps?.length > 0 && (
        <div className="flex flex-col gap-2">
          {timestamps.map((t) => (
            <button
              key={t.time}
              type="button"
              className="flex items-center gap-3 text-left cursor-pointer hover:bg-grey-100 rounded-lg p-2 -m-2"
            >
              <span className="inline-flex rounded-md bg-teal-050 px-2 py-1 text-xs font-bold text-teal-700 shrink-0">
                {t.time}
              </span>
              <span className="text-sm text-grey-600">{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CertificationReviewPanel({ cert, onClose }) {
  if (!cert) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:w-[600px] lg:w-[42vw] h-full bg-white overflow-y-auto flex flex-col">
        <div className="flex items-start gap-4 px-8 pt-8 pb-6 border-b border-grey-300">
          <button
            type="button"
            onClick={onClose}
            className="mt-1 text-grey-500 hover:text-teal-950 cursor-pointer shrink-0"
          >
            <ArrowLeftIcon className="size-5" />
          </button>
          <div className="flex flex-col gap-1">
            <h2 className="font-serif font-semibold text-2xl text-teal-950">
              {cert.name}
            </h2>
            <p className="text-sm text-grey-600">
              {cert.restaurant} &middot; {cert.role}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-6 px-8 py-6 flex-1">
          {cert.status === "pendingReview" && (
            <>
              <ScoreBox cert={cert} />

              <div className="flex flex-col gap-3">
                <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                  Automated integrity checks
                </p>
                <div className="flex flex-col gap-3">
                  {cert.integrityChecks.map((check) => (
                    <div key={check.label} className="flex items-start gap-3">
                      {check.status === "pass" ? (
                        <div className="flex items-center justify-center size-5 rounded-full bg-green-100 text-green-700 shrink-0 mt-0.5">
                          <CheckIcon className="size-3" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center size-5 rounded-full bg-yellow-100 text-yellow-700 shrink-0 mt-0.5">
                          <WarningIcon className="size-3" />
                        </div>
                      )}
                      <div className="flex flex-col gap-0.5">
                        <p className="text-sm font-semibold text-teal-950">
                          {check.label}
                        </p>
                        {check.note && (
                          <p className="text-xs text-grey-500">{check.note}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <FacecamPlayer timestamps={cert.flaggedTimestamps} />

              <div className="flex flex-col gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                  Reviewer&apos;s decision reasoning
                </p>
                <textarea
                  rows={4}
                  placeholder="Explain your decision..."
                  className="w-full rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700 resize-none"
                />
              </div>
            </>
          )}

          {cert.status === "approved" && (
            <>
              <div className="rounded-lg bg-green-100 p-4 flex flex-col gap-1">
                <p className="text-base font-semibold text-green-700">
                  Approved by {cert.reviewedBy} on {cert.reviewedDate}
                </p>
              </div>

              <ScoreBox cert={cert} />

              <div className="flex flex-col gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                  Reviewer&apos;s decision reasoning
                </p>
                <p className="rounded-lg border border-grey-300 bg-grey-100 px-4 py-3 text-base text-grey-600">
                  {cert.reasoning}
                </p>
              </div>

              <Button variant="primary" size="sm" className="w-fit">
                View credential
              </Button>

              <p className="text-xs text-grey-500">
                Read-only &middot; appeal window closed
              </p>
            </>
          )}

          {cert.status === "rejected" && (
            <>
              <div className="rounded-lg bg-red-100 p-4 flex flex-col gap-1">
                <p className="text-base font-semibold text-red-700">
                  Rejected by {cert.reviewedBy} on {cert.reviewedDate}
                </p>
              </div>

              <ScoreBox cert={cert} />

              <div className="rounded-lg bg-yellow-100 p-4 flex flex-col gap-1">
                <p className="text-sm font-semibold text-yellow-700">
                  Passed threshold, but rejected on integrity
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                  Reviewer&apos;s decision reasoning
                </p>
                <p className="rounded-lg border border-grey-300 bg-grey-100 px-4 py-3 text-base text-grey-600">
                  {cert.reasoning}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                  What was flagged
                </p>
                <FacecamPlayer timestamps={cert.flaggedTimestamps} />
              </div>

              <Button variant="outline" size="sm" className="w-fit">
                View credential
              </Button>
            </>
          )}
        </div>

        {cert.status === "pendingReview" && (
          <div className="flex items-center justify-between gap-4 px-8 py-6 border-t border-grey-300">
            <Button
              variant="outline"
              size="sm"
              className="border-red-600 text-red-700 hover:bg-red-100"
            >
              Reject
            </Button>
            <Button variant="primary" size="sm" className="bg-green-700 hover:bg-green-800">
              Approve credential
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
