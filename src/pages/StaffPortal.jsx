import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import PortalShell from "../components/portal/PortalShell";
import {
  getLearnerHome,
  getLearnerCertificate,
  getLearnerProfile,
  updateLearnerProfile,
  ApiError,
} from "../lib/api";

function WarningIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 2.5 18 16.5H2z" />
      <path d="M10 8v3.5" />
      <circle cx="10" cy="14" r="0.5" fill="currentColor" />
    </svg>
  );
}

function CheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 10.5 8 14.5 16 6" />
    </svg>
  );
}

function firstIncompleteLesson(module) {
  return module.lessons.find((l) => l.status !== "complete") ?? module.lessons[0];
}

function daysUntil(dateStr) {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

const MODULE_STATUS_LABEL = {
  complete: "Completed",
  in_progress: "In progress",
  not_started: "Not started",
  locked: "Locked",
};

export default function StaffPortal() {
  const [course, setCourse] = useState(null);
  const [profile, setProfile] = useState(null);
  const [certificate, setCertificate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");

  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getLearnerHome(),
      getLearnerProfile(),
      getLearnerCertificate().catch((err) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }),
    ])
      .then(([homeRes, profileRes, certRes]) => {
        if (cancelled) return;
        setCourse(homeRes);
        setProfile(profileRes);
        setCertificate(certRes);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Failed to load your profile."
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
      <PortalShell activeNav="profile">
        <p className="text-base text-grey-600">Loading your profile&hellip;</p>
      </PortalShell>
    );
  }

  if (error || !course || !profile) {
    return (
      <PortalShell activeNav="profile">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error || "Something went wrong."}
        </p>
      </PortalShell>
    );
  }

  const { modules } = course;
  const totalLessons = modules.reduce((sum, m) => sum + m.totalCount, 0);
  const completedLessons = modules.reduce((sum, m) => sum + m.completedCount, 0);
  const overallPct =
    totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100);

  const activeModule =
    modules.find((m) => m.status === "in_progress") ||
    modules.find((m) => m.status === "not_started");
  const resumeLesson = activeModule ? firstIncompleteLesson(activeModule) : null;

  const verifyUrl = certificate
    ? `${window.location.origin}/verify/${certificate.certCode}`
    : null;

  const restaurantAddress = profile.restaurant
    ? [
        profile.restaurant.address,
        [profile.restaurant.city, profile.restaurant.state].filter(Boolean).join(", "),
      ]
        .filter(Boolean)
        .join(" \u00b7 ")
    : null;

  const handleCopy = async () => {
    if (!verifyUrl) return;
    try {
      await navigator.clipboard.writeText(verifyUrl);
      setCopied(true);
      setCopyError("");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError("Couldn't copy \u2014 copy it manually instead.");
      setTimeout(() => setCopyError(""), 3000);
    }
  };

  const startEditName = () => {
    setNameDraft(profile.fullName);
    setNameError("");
    setEditingName(true);
  };

  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setSavingName(true);
    try {
      const res = await updateLearnerProfile({ fullName: trimmed });
      setProfile((p) => ({ ...p, fullName: res.fullName }));
      setEditingName(false);
      setNameError("");
    } catch (err) {
      setNameError(
        err instanceof ApiError ? err.message : "Failed to update your profile."
      );
    } finally {
      setSavingName(false);
    }
  };

  return (
    <PortalShell activeNav="profile">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            Hi, {profile.fullName.split(" ")[0]}
          </h1>
          <p className="text-base text-grey-600">
            {certificate
              ? `Your credential is current \u2014 and your renewal is due in ${daysUntil(
                  certificate.expiresAt
                )} days.`
              : `You're ${overallPct}% through your certification course.`}
          </p>
        </div>
        {certificate?.pdfUrl && (
          <a href={certificate.pdfUrl} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              Download badge
            </Button>
          </a>
        )}
      </div>

      {activeModule && (
        <div className="rounded-2xl bg-yellow-100 p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
          <p className="flex items-start gap-2.5 text-base text-yellow-700 max-w-[720px]">
            <WarningIcon className="size-5 shrink-0 mt-0.5" />
            {certificate ? (
              <span>
                <span className="font-semibold">
                  Renewal due {new Date(certificate.expiresAt).toLocaleDateString()}.
                </span>{" "}
                Finish the recertification course and exam to keep your credential
                current. You&apos;re {overallPct}% through.
              </span>
            ) : (
              <span>
                <span className="font-semibold">
                  You&apos;re {overallPct}% through your certification course.
                </span>{" "}
                Finish the course and pass the exam to get certified.
              </span>
            )}
          </p>
          <Link to="/portal/course">
            <Button variant="primary" size="sm" className="bg-teal-900 hover:bg-teal-950">
              Pick where I left off
            </Button>
          </Link>
        </div>
      )}

      {certificate && (
        <div className="rounded-2xl border border-grey-300 bg-gradient-to-br from-teal-050 to-white p-6 sm:p-8 flex flex-col md:flex-row gap-8 justify-between">
          <div className="flex flex-col gap-6 flex-1">
            <Badge tone="tealDark" className="w-fit">
              ACTIVE
            </Badge>

            <div className="flex flex-col gap-1">
              <h2 className="font-serif font-semibold text-2xl text-teal-950">
                Allergen Safety Certification
              </h2>
              <p className="text-base text-grey-600">Issued by AllergenWise</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-5 pt-6 border-t border-grey-300">
              <div className="flex flex-col gap-1">
                <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                  Credential ID
                </p>
                <p className="text-base font-semibold text-teal-950">
                  {certificate.certCode}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                  Issued
                </p>
                <p className="text-base font-semibold text-teal-950">
                  {new Date(certificate.issuedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                  Valid through
                </p>
                <p className="text-base font-semibold text-teal-950">
                  {new Date(certificate.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                  Restaurant
                </p>
                <p className="text-base font-semibold text-teal-950">
                  {certificate.restaurantName}
                </p>
              </div>
              {profile.jobRole && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                    Role
                  </p>
                  <p className="text-base font-semibold text-teal-950">
                    {profile.jobRole}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center gap-3 shrink-0 md:w-[280px]">
            <div className="w-full aspect-square rounded-xl bg-white border border-grey-300 flex items-center justify-center">
              <p className="text-lg font-bold text-grey-400">QR HERE</p>
            </div>
            <p className="text-base font-semibold text-teal-950">
              {certificate.certCode}
            </p>
            <p className="text-sm text-grey-500 text-center">
              Diners &amp; inspectors can scan this
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-6">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                My recertification course
              </p>
              <Link
                to="/portal/course"
                className="text-sm font-semibold text-teal-700 hover:text-teal-800"
              >
                Continue &rarr;
              </Link>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-4">
                <p className="text-base font-semibold text-teal-950">
                  {overallPct}% complete
                </p>
                {activeModule && resumeLesson && (
                  <p className="text-sm text-grey-500">
                    Module {activeModule.orderIndex} of {modules.length} &middot;
                    Lesson {activeModule.orderIndex}.{resumeLesson.orderIndex}
                  </p>
                )}
              </div>
              <div className="h-2 w-full rounded-full bg-grey-300 overflow-hidden">
                <div
                  className="h-full rounded-full bg-teal-700"
                  style={{ width: `${overallPct}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col">
              {modules.map((mod, i) => (
                <div
                  key={mod.id}
                  className={`flex items-center justify-between gap-4 py-3.5 ${
                    i > 0 ? "border-t border-grey-300" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {mod.status === "complete" ? (
                      <span className="flex items-center justify-center size-6 rounded-full bg-green-100 text-green-700 shrink-0">
                        <CheckIcon className="size-3.5" />
                      </span>
                    ) : (
                      <span
                        className={`flex items-center justify-center size-6 rounded-full text-xs font-bold shrink-0 ${
                          mod.status === "in_progress"
                            ? "bg-teal-700 text-white"
                            : "bg-grey-300 text-grey-500"
                        }`}
                      >
                        {mod.orderIndex}
                      </span>
                    )}
                    <p className="text-base text-teal-950">
                      Module {mod.orderIndex} &middot; {mod.title}
                    </p>
                  </div>
                  <p
                    className={`text-sm whitespace-nowrap ${
                      mod.status === "locked" ? "text-grey-400" : "text-grey-500"
                    }`}
                  >
                    {MODULE_STATUS_LABEL[mod.status] ?? mod.status}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {certificate && (
            <div className="rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-4">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Public verification link
              </p>
              <p className="text-base text-grey-600">
                This is the URL your badge QR points to. Anyone with the link or
                QR can verify your credential live.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[240px] rounded-lg bg-teal-050 px-4 py-3 text-base font-semibold text-teal-700 truncate">
                  {verifyUrl}
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-lg bg-teal-050 px-4 py-3 text-base font-semibold text-teal-700 hover:bg-teal-100 cursor-pointer"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <a href={verifyUrl} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm">
                    Preview
                  </Button>
                </a>
              </div>
              {copyError && (
                <p className="text-sm font-medium text-red-600">{copyError}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {profile.restaurant && (
            <div className="rounded-2xl border border-grey-300 bg-white p-6 flex flex-col gap-1">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500 pb-3">
                Where I work
              </p>
              <div className="flex items-center gap-3 pb-4">
                <div className="flex items-center justify-center size-9 rounded-full bg-teal-100 text-xs font-bold text-teal-700 shrink-0">
                  {profile.restaurant.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex flex-col">
                  <p className="text-base font-semibold text-teal-950">
                    {profile.restaurant.name}
                  </p>
                  {restaurantAddress && (
                    <p className="text-sm text-grey-500">{restaurantAddress}</p>
                  )}
                </div>
              </div>

              {profile.jobRole && (
                <div className="flex items-center justify-between gap-4 py-3 border-t border-grey-300">
                  <p className="text-base text-grey-600">My Role</p>
                  <p className="text-base font-semibold text-teal-950">
                    {profile.jobRole}
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 py-3 border-t border-grey-300">
                <p className="text-base text-grey-600">Since</p>
                <p className="text-base font-semibold text-teal-950">
                  {new Date(profile.since).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center justify-between gap-4 py-3 border-t border-grey-300">
                <p className="text-base text-grey-600">Restaurant status</p>
                <p className="flex items-center gap-1.5 text-base font-semibold text-green-700">
                  <span className="size-1.5 rounded-full bg-green-700" />
                  {profile.staffCounts.certified}/{profile.staffCounts.total}{" "}
                  certified
                </p>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-grey-300 bg-white p-6 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-4 pb-3">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                My profile
              </p>
              {!editingName && (
                <button
                  type="button"
                  onClick={startEditName}
                  className="text-sm font-semibold text-teal-700 hover:text-teal-800 cursor-pointer"
                >
                  Edit &rarr;
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1 py-3 border-t border-grey-300">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Full name
              </p>
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="flex-1 rounded-md border border-grey-300 px-3 py-1.5 text-base font-semibold text-teal-950"
                  />
                  <button
                    type="button"
                    onClick={saveName}
                    disabled={savingName}
                    className="text-sm font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-60 cursor-pointer"
                  >
                    {savingName ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingName(false);
                      setNameError("");
                    }}
                    disabled={savingName}
                    className="text-sm font-semibold text-grey-500 hover:text-grey-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <p className="text-base font-semibold text-teal-950">
                  {profile.fullName}
                </p>
              )}
              {nameError && (
                <p className="text-sm font-medium text-red-600">{nameError}</p>
              )}
            </div>
            <div className="flex flex-col gap-1 py-3 border-t border-grey-300">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Personal email
              </p>
              <p className="text-base font-semibold text-teal-950">
                {profile.email}
              </p>
            </div>
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
