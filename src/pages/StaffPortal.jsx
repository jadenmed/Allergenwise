import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import PortalShell, { STAFF_MEMBER, WORK_RESTAURANT } from "../components/portal/PortalShell";

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

const CREDENTIAL = {
  title: "Allergen Safety Certification",
  issuedBy: "Issued by AllergenWise \u00b7 talentMLS program",
  status: "ACTIVE",
  credentialId: "AW-PDX-8FQ2-K9-02",
  issued: "Jun 22, 2025",
  validThrough: "Jun 22, 2026",
  score: "88% Pass",
  role: "Head Chef",
};

const MODULES = [
  { key: "accredited", label: "Independently accredited", state: "done", note: "Done May 12" },
  { key: "m2", label: "Module 2 \u00b7 Cross-contact & the kitchen", state: "done", note: "Done May 12" },
  { key: "m3", label: "Module 3 \u00b7 Front-of-house", state: "current", note: "In progress", number: 3 },
  { key: "m4", label: "Module 4 \u00b7 Cleaning & sourcing", state: "locked", note: "Locked", number: 4 },
  { key: "m5", label: "Module 5 \u00b7 Emergency response", state: "locked", note: "Locked", number: 5 },
];

export default function StaffPortal() {
  return (
    <PortalShell activeNav="profile">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            Hi, {STAFF_MEMBER.name.split(" ")[0]}
          </h1>
          <p className="text-base text-grey-600">
            Your credential is current &mdash; and your renewal is due in 23 days.
          </p>
        </div>
        <Button variant="outline" size="sm">
          Download badge
        </Button>
      </div>

      <div className="rounded-2xl bg-yellow-100 p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
        <p className="flex items-start gap-2.5 text-base text-yellow-700 max-w-[720px]">
          <WarningIcon className="size-5 shrink-0 mt-0.5" />
          <span>
            <span className="font-semibold">Renewal due Jun 22, 2026.</span>{" "}
            Finish the recertification course and exam to keep your credential
            &mdash; and the restaurant&apos;s window seal &mdash; current.
            You&apos;re 52% through.
          </span>
        </p>
        <Link to="/portal/course">
          <Button variant="primary" size="sm" className="bg-teal-900 hover:bg-teal-950">
            Pick where I left off
          </Button>
        </Link>
      </div>

      <div className="rounded-2xl border border-grey-300 bg-gradient-to-br from-teal-050 to-white p-6 sm:p-8 flex flex-col md:flex-row gap-8 justify-between">
        <div className="flex flex-col gap-6 flex-1">
          <Badge tone="tealDark" className="w-fit">
            {CREDENTIAL.status}
          </Badge>

          <div className="flex flex-col gap-1">
            <h2 className="font-serif font-semibold text-2xl text-teal-950">
              {CREDENTIAL.title}
            </h2>
            <p className="text-base text-grey-600">{CREDENTIAL.issuedBy}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-5 pt-6 border-t border-grey-300">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Credential ID
              </p>
              <p className="text-base font-semibold text-teal-950">
                {CREDENTIAL.credentialId}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Issued
              </p>
              <p className="text-base font-semibold text-teal-950">
                {CREDENTIAL.issued}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Valid through
              </p>
              <p className="text-base font-semibold text-teal-950">
                {CREDENTIAL.validThrough}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Score
              </p>
              <p className="text-base font-semibold text-teal-950">
                {CREDENTIAL.score}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Restaurant
              </p>
              <p className="text-base font-semibold text-teal-950">
                {WORK_RESTAURANT.name}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Role at issue
              </p>
              <p className="text-base font-semibold text-teal-950">
                {CREDENTIAL.role}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 shrink-0 md:w-[280px]">
          <div className="w-full aspect-square rounded-xl bg-white border border-grey-300 flex items-center justify-center">
            <p className="text-lg font-bold text-grey-400">QR HERE</p>
          </div>
          <p className="text-base font-semibold text-teal-950">AW-PDX-8FQ2-K9</p>
          <p className="text-sm text-grey-500 text-center">
            Diners &amp; inspectors can scan this
          </p>
        </div>
      </div>

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
                  52% complete
                </p>
                <p className="text-sm text-grey-500">Module 3 of 5 &middot; Lesson 3.2</p>
              </div>
              <div className="h-2 w-full rounded-full bg-grey-300 overflow-hidden">
                <div className="h-full rounded-full bg-teal-700" style={{ width: "52%" }} />
              </div>
            </div>

            <div className="flex flex-col">
              {MODULES.map((mod, i) => (
                <div
                  key={mod.key}
                  className={`flex items-center justify-between gap-4 py-3.5 ${
                    i > 0 ? "border-t border-grey-300" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {mod.state === "done" ? (
                      <span className="flex items-center justify-center size-6 rounded-full bg-green-100 text-green-700 shrink-0">
                        <CheckIcon className="size-3.5" />
                      </span>
                    ) : (
                      <span
                        className={`flex items-center justify-center size-6 rounded-full text-xs font-bold shrink-0 ${
                          mod.state === "current"
                            ? "bg-teal-700 text-white"
                            : "bg-grey-300 text-grey-500"
                        }`}
                      >
                        {mod.number}
                      </span>
                    )}
                    <p className="text-base text-teal-950">{mod.label}</p>
                  </div>
                  <p
                    className={`text-sm whitespace-nowrap ${
                      mod.state === "locked" ? "text-grey-400" : "text-grey-500"
                    }`}
                  >
                    {mod.note}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-4">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Public verification link
            </p>
            <p className="text-base text-grey-600">
              This is the URL your badge QR points to. Anyone with the link or
              QR can verify your credential live.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[240px] rounded-lg bg-teal-050 px-4 py-3 text-base font-semibold text-teal-700">
                allergenwise.com/s/AW-DK-7H4M
              </div>
              <button
                type="button"
                className="rounded-lg bg-teal-050 px-4 py-3 text-base font-semibold text-teal-700 hover:bg-teal-100 cursor-pointer"
              >
                Copy
              </button>
              <Button variant="outline" size="sm">
                Preview
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-grey-300 bg-white p-6 flex flex-col gap-1">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500 pb-3">
              Where I work
            </p>
            <div className="flex items-center gap-3 pb-4">
              <div className="flex items-center justify-center size-9 rounded-full bg-teal-100 text-xs font-bold text-teal-700 shrink-0">
                {WORK_RESTAURANT.initials}
              </div>
              <div className="flex flex-col">
                <p className="text-base font-semibold text-teal-950">
                  {WORK_RESTAURANT.name}
                </p>
                <p className="text-sm text-grey-500">{WORK_RESTAURANT.address}</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 py-3 border-t border-grey-300">
              <p className="text-base text-grey-600">My Role</p>
              <p className="text-base font-semibold text-teal-950">
                {STAFF_MEMBER.role}
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 py-3 border-t border-grey-300">
              <p className="text-base text-grey-600">Since</p>
              <p className="text-base font-semibold text-teal-950">Jun 14, 2025</p>
            </div>
            <div className="flex items-center justify-between gap-4 py-3 border-t border-grey-300">
              <p className="text-base text-grey-600">Manager</p>
              <p className="text-base font-semibold text-teal-950">Maria Reyes</p>
            </div>
            <div className="flex items-center justify-between gap-4 py-3 border-t border-grey-300">
              <p className="text-base text-grey-600">Restaurant status</p>
              <p className="flex items-center gap-1.5 text-base font-semibold text-green-700">
                <span className="size-1.5 rounded-full bg-green-700" />
                Active {WORK_RESTAURANT.staffCertifiedCount}/
                {WORK_RESTAURANT.staffTotalCount}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-grey-300 bg-white p-6 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-4 pb-3">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                My profile
              </p>
              <button
                type="button"
                className="text-sm font-semibold text-teal-700 hover:text-teal-800 cursor-pointer"
              >
                Edit &rarr;
              </button>
            </div>

            <div className="flex flex-col gap-1 py-3 border-t border-grey-300">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Full name
              </p>
              <p className="text-base font-semibold text-teal-950">
                {STAFF_MEMBER.name}
              </p>
            </div>
            <div className="flex flex-col gap-1 py-3 border-t border-grey-300">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Personal email
              </p>
              <p className="text-base font-semibold text-teal-950">
                daniel.kim@gardentable.co
              </p>
            </div>
            <div className="flex flex-col gap-1 py-3 border-t border-grey-300">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Phone
              </p>
              <p className="text-base font-semibold text-teal-950">
                +1 (503) 555-0184
              </p>
            </div>
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
