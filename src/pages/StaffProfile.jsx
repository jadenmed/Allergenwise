import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Button from "../components/ui/Button";
import SectionCard from "../components/ui/SectionCard";
import DashboardShell from "../components/dashboard/DashboardShell";
import RenewCredentialModal from "../components/dashboard/RenewCredentialModal";
import { STAFF } from "./Staff";

function ChevronRightIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7.5 4.5 13 10l-5.5 5.5" />
    </svg>
  );
}

function ArrowLeftIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.5 4.5 6 11l6.5 6.5" />
    </svg>
  );
}

const STATUS_STYLES = {
  active: "text-green-700",
  renew: "text-yellow-700",
};

const AVATAR_TONES = {
  teal: "bg-teal-100 text-teal-700",
  yellow: "bg-yellow-100 text-yellow-700",
};

const ACTIONS = [
  { key: "renew", label: "Renew credential", description: "Start a new certification course" },
  { key: "download", label: "Download certificate", description: "PDF copy of the current credential" },
  { key: "print", label: "Print badge QR", description: "Printable QR badge for this staff member" },
  { key: "edit", label: "Edit role & details", description: "Update role, employment, and contact info" },
];

export default function StaffProfile() {
  const { id } = useParams();
  const [renewOpen, setRenewOpen] = useState(false);
  const person = STAFF.find((s) => s.id === id);

  if (!person) {
    return (
      <DashboardShell activeNav="staff">
        <p className="text-base text-grey-600">Staff member not found.</p>
        <Link to="/dashboard/staff" className="text-sm font-semibold text-teal-700">
          Back to Staff
        </Link>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell activeNav="staff">
      <Link
        to="/dashboard/staff"
        className="flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:text-teal-800 w-fit"
      >
        <ArrowLeftIcon className="size-4" />
        Back to Staff
      </Link>

      <div className="flex flex-wrap items-center gap-4">
        <div
          className={`flex items-center justify-center size-14 rounded-full text-lg font-bold shrink-0 ${AVATAR_TONES[person.avatarTone]}`}
        >
          {person.initials}
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            {person.name}
          </h1>
          <p
            className={`flex items-center gap-1.5 text-sm font-semibold ${STATUS_STYLES[person.status]}`}
          >
            <span
              className={`size-1.5 rounded-full ${
                person.status === "active" ? "bg-green-700" : "bg-yellow-700"
              }`}
            />
            {person.role} &middot; {person.statusLabel}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="flex flex-col gap-6">
          <SectionCard title="Personal information">
            <div className="grid grid-cols-2 gap-5">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Full name</p>
                <p className="text-base text-teal-950">{person.name}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Email</p>
                <p className="text-base text-teal-950">{person.email}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Role</p>
                <p className="text-base text-teal-950">{person.role}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Employment</p>
                <p className="text-base text-teal-950">{person.employment}</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Credential summary">
            {person.status === "renew" && (
              <div className="rounded-lg bg-yellow-100 p-4 flex flex-col gap-1">
                <p className="text-base font-semibold text-yellow-700">
                  Renewal coming up
                </p>
                <p className="text-sm text-yellow-700">
                  This credential expires soon. Start the renewal course to
                  avoid a gap in coverage.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-5">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Badge QR</p>
                {person.badgeQr ? (
                  <span className="inline-flex w-fit rounded-md bg-teal-050 px-2.5 py-1 text-sm font-semibold text-teal-700">
                    {person.badgeQr}
                  </span>
                ) : (
                  <p className="text-base text-grey-400">&mdash;</p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Credential ID</p>
                <p className="text-base text-teal-950">
                  {person.credential ?? (
                    <span className="text-grey-400">Pending</span>
                  )}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Issued</p>
                <p className="text-base text-teal-950">{person.issued ?? "\u2014"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Expires</p>
                <p className="text-base text-teal-950">{person.expires ?? "\u2014"}</p>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="flex flex-col gap-6">
          <SectionCard title="Actions">
            <div className="flex flex-col">
              {ACTIONS.map((action, i) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={action.key === "renew" ? () => setRenewOpen(true) : undefined}
                  className={`flex items-center justify-between gap-4 py-4 text-left cursor-pointer hover:bg-grey-100 -mx-2 px-2 rounded-lg ${
                    i > 0 ? "border-t border-grey-300" : ""
                  }`}
                >
                  <div className="flex flex-col gap-0.5">
                    <p className="text-base font-semibold text-teal-950">
                      {action.label}
                    </p>
                    <p className="text-sm text-grey-500">{action.description}</p>
                  </div>
                  <ChevronRightIcon className="size-4 text-grey-400 shrink-0" />
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Remove staff member">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4 rounded-lg bg-grey-100 p-4">
                <div className="flex flex-col gap-0.5">
                  <p className="text-base font-semibold text-teal-950">
                    Suspend access
                  </p>
                  <p className="text-sm text-grey-600">
                    Temporarily disable this badge without removing them.
                  </p>
                </div>
                <Button variant="outline" size="sm">
                  Suspend
                </Button>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg bg-red-100 p-4">
                <div className="flex flex-col gap-0.5">
                  <p className="text-base font-semibold text-red-700">
                    Remove from restaurant
                  </p>
                  <p className="text-sm text-red-700">
                    Permanently revokes this credential. This can&apos;t be
                    undone.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-600 text-red-700 hover:bg-red-100"
                >
                  Remove
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      <RenewCredentialModal
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        person={person}
      />
    </DashboardShell>
  );
}
