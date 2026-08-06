import { useState } from "react";
import { Link } from "react-router-dom";
import { LogoMark } from "../components/Logo";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import DashboardShell, { RESTAURANT, OWNER } from "../components/dashboard/DashboardShell";
import InviteStaffModal from "../components/dashboard/InviteStaffModal";
import iconPlus from "../assets/icon-plus.svg";

const SUBMISSION_STATUS_CONFIG = {
  notSubmitted: {
    badge: null,
    body: "Your account is set up. To start certifying staff, submit your restaurant for review. Most submissions get a decision within 3 business days.",
    cta: { label: "Submit your restaurant", variant: "primary", arrow: false, to: "/dashboard/submit" },
  },
  waitingForReview: {
    badge: { label: "Waiting for review", tone: "yellow" },
    body: "You have submitted your restaurant for review. To check the status of your restaurant submission, click the button below.",
    cta: { label: "View submission status", variant: "outline", arrow: true, to: "/dashboard/status" },
  },
  inReview: {
    badge: { label: "In review", tone: "teal" },
    body: "You have submitted your restaurant for review. To check the status of your restaurant submission, click the button below.",
    cta: { label: "View submission status", variant: "outline", arrow: true, to: "/dashboard/status" },
  },
  infoRequested: {
    badge: { label: "Info requested", tone: "green" },
    body: "It seems we need a bit more from you. We have reviewed your submission and there are things that still needs to be required. Please view and add the requirements to continue.",
    cta: { label: "View requirements", variant: "primary", arrow: true, to: "/dashboard/status" },
  },
  declined: {
    badge: { label: "Declined", tone: "red" },
    body: "You have submitted your restaurant for review. But, it seems we have found some issues and could not proceed with your submission.",
    cta: { label: "Learn why", variant: "primary", arrow: true, to: "/dashboard/status" },
  },
};

const STATS = [
  { label: "Staff certified", value: "9 / 9", caption: "All current" },
  {
    label: "Days to next renewal",
    value: "24",
    caption: "Daniel K. \u00b7 Mar 22",
  },
  {
    label: "Verification scans (30d)",
    value: "1,247",
    caption: "\u2191 18% vs last month",
    captionTone: "green",
  },
];

const STAFF = [
  {
    initials: "MR",
    name: "Maria Reyes",
    role: "General Manager",
    badgeQr: "AW-MR-3F2K",
    credential: "AW-PDX-8FQ2-K9-01",
    expires: "Mar 4, 2027",
    status: "active",
    statusLabel: "Active",
    action: "View",
  },
  {
    initials: "DK",
    name: "Daniel Kim",
    role: "Head Chef",
    badgeQr: "AW-DK-7H4M",
    credential: "AW-PDX-8FQ2-K9-02",
    expires: "Mar 22, 2026",
    status: "renew",
    statusLabel: "Renew in 24d",
    action: "Renew",
  },
  {
    initials: "AO",
    name: "Amara Okafor",
    role: "Server",
    badgeQr: "AW-AD-9P1Q",
    credential: "AW-PDX-8FQ2-K9-03",
    expires: "Mar 4, 2027",
    status: "active",
    statusLabel: "Active",
    action: "View",
  },
  {
    initials: "LS",
    name: "Luis Soto",
    role: "Line Cook",
    badgeQr: "AW-LS-2W5N",
    credential: "AW-PDX-8FQ2-K9-04",
    expires: "Mar 4, 2027",
    status: "active",
    statusLabel: "Active",
    action: "View",
  },
  {
    initials: "HT",
    name: "Hannah Tran",
    role: "Server",
    badgeQr: "AW-HT-6V8B",
    credential: "AW-PDX-8FQ2-K9-05",
    expires: "Mar 4, 2027",
    status: "active",
    statusLabel: "Active",
    action: "View",
  },
];

function DownloadIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5" />
      <path d="M3.5 15.5v1a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

function QrFinder({ x, y, size }) {
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} fill="#000" />
      <rect x={x + 2} y={y + 2} width={size - 4} height={size - 4} fill="#fff" />
      <rect x={x + 5} y={y + 5} width={size - 10} height={size - 10} fill="#000" />
    </g>
  );
}

function QrPlaceholder({ className = "" }) {
  const cols = 21;
  const cell = 8;
  const dim = cols * cell;
  const finderSize = cell * 7;
  const cells = [];
  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      const inTopLeft = r < 7 && c < 7;
      const inTopRight = r < 7 && c >= cols - 7;
      const inBottomLeft = r >= cols - 7 && c < 7;
      if (inTopLeft || inTopRight || inBottomLeft) continue;
      const on = (r * 13 + c * 7 + r * c * 3) % 5 < 2;
      if (on) cells.push([r, c]);
    }
  }
  return (
    <svg viewBox={`0 0 ${dim} ${dim}`} className={className}>
      <rect x="0" y="0" width={dim} height={dim} fill="#fff" />
      {cells.map(([r, c]) => (
        <rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell} height={cell} fill="#000" />
      ))}
      <QrFinder x={0} y={0} size={finderSize} />
      <QrFinder x={dim - finderSize} y={0} size={finderSize} />
      <QrFinder x={0} y={dim - finderSize} size={finderSize} />
    </svg>
  );
}

const STATUS_STYLES = {
  active: "text-green-700",
  renew: "text-yellow-700",
};

function SubmissionStatusPanel({ status, ownerFirstName }) {
  const config = SUBMISSION_STATUS_CONFIG[status];

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-[640px] flex flex-col items-center gap-6 rounded-2xl border border-grey-300 bg-white px-8 py-16 text-center">
        <div className="flex items-center justify-center size-16 rounded-2xl border-2 border-teal-700 text-teal-700">
          <LogoMark className="size-9" />
        </div>

        {config.badge && <Badge tone={config.badge.tone}>{config.badge.label}</Badge>}

        <div className="flex flex-col gap-3">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            Welcome to AllergenWise, {ownerFirstName}
          </h1>
          <p className="max-w-[440px] text-base text-grey-600">{config.body}</p>
        </div>

        {config.cta.to ? (
          <Link to={config.cta.to}>
            <Button variant={config.cta.variant} size="sm">
              {config.cta.label}
              {config.cta.arrow ? " \u2192" : ""}
            </Button>
          </Link>
        ) : (
          <Button variant={config.cta.variant} size="sm">
            {config.cta.label}
            {config.cta.arrow ? " \u2192" : ""}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <DashboardShell activeNav="overview">
      {RESTAURANT.status !== "active" ? (
        <SubmissionStatusPanel
          status={RESTAURANT.status}
          ownerFirstName={OWNER.name.split(" ")[0]}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="font-serif font-semibold text-3xl text-teal-950">
                Welcome back, Maria
              </h1>
              <p className="text-base text-grey-600">
                Your certification is current. One staff renewal is coming up
                in 24 days.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={iconPlus}
              onClick={() => setInviteOpen(true)}
            >
              Invite staff
            </Button>
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
                    stat.captionTone === "green"
                      ? "text-green-700"
                      : "text-grey-500"
                  }`}
                >
                  {stat.caption}
                </p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
            <div className="rounded-2xl border border-grey-300 bg-white p-6 flex flex-col gap-5">
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                  Certification status
                </p>
                <Badge tone="tealDark">Active</Badge>
              </div>

              <div className="flex flex-col">
                <div className="flex items-center justify-between py-3 border-t border-grey-300">
                  <p className="text-base text-grey-600">Credential ID</p>
                  <p className="text-base font-semibold text-teal-950">
                    {RESTAURANT.credentialId}
                  </p>
                </div>
                <div className="flex items-center justify-between py-3 border-t border-grey-300">
                  <p className="text-base text-grey-600">Issued</p>
                  <p className="text-base font-semibold text-teal-950">
                    {RESTAURANT.issued}
                  </p>
                </div>
                <div className="flex items-center justify-between py-3 border-t border-grey-300">
                  <p className="text-base text-grey-600">Valid through</p>
                  <p className="text-base font-semibold text-teal-950">
                    {RESTAURANT.validThrough}
                  </p>
                </div>
                <div className="flex items-center justify-between py-3 border-t border-grey-300">
                  <p className="text-base text-grey-600">Public listing</p>
                  <p className="text-base font-semibold text-green-700">
                    Live &middot; {RESTAURANT.diner30dViews} diner views (30d)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <Link to={`/verify/${RESTAURANT.credentialId}`} className="self-start">
                  <Button variant="outline" size="sm">
                    View public verification page
                  </Button>
                </Link>
                <Link
                  to="/dashboard/record"
                  className="text-sm font-semibold text-teal-700 hover:text-teal-800"
                >
                  View full certification record
                </Link>
              </div>
            </div>

            <div className="rounded-2xl bg-teal-900 p-6 flex flex-col items-center gap-4 text-center">
              <p className="w-full text-left text-xs font-bold uppercase tracking-wide text-white">
                Window seal QR
              </p>
              <div className="w-full max-w-[220px] rounded-xl bg-white p-4">
                <QrPlaceholder className="w-full h-auto" />
              </div>
              <p className="text-base font-semibold text-white">
                {RESTAURANT.credentialId}
              </p>
              <p className="text-sm text-teal-100">
                Download for the print shop.
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white cursor-pointer transition-colors"
                >
                  <DownloadIcon className="size-4" />
                  .SVG
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white cursor-pointer transition-colors"
                >
                  <DownloadIcon className="size-4" />
                  .PNG
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-grey-300 bg-white p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Staff &amp; credentials
              </p>
              <Button variant="outline" size="sm" icon={iconPlus}>
                Invite staff
              </Button>
            </div>

            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="bg-teal-050">
                    <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                      Person
                    </th>
                    <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                      Role
                    </th>
                    <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                      Badge QR
                    </th>
                    <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                      Credential
                    </th>
                    <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                      Expires
                    </th>
                    <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                      Status
                    </th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {STAFF.map((person) => (
                    <tr key={person.credential} className="border-t border-grey-300">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex items-center justify-center size-8 rounded-full bg-teal-100 text-xs font-bold text-teal-700 shrink-0">
                            {person.initials}
                          </div>
                          <p className="text-base text-teal-950 whitespace-nowrap">
                            {person.name}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                        {person.role}
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex rounded-md bg-teal-050 px-2.5 py-1 text-sm font-semibold text-teal-700 whitespace-nowrap">
                          {person.badgeQr}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                        {person.credential}
                      </td>
                      <td className="px-3 py-3 text-base text-teal-950 whitespace-nowrap">
                        {person.expires}
                      </td>
                      <td className="px-3 py-3">
                        <p
                          className={`flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap ${STATUS_STYLES[person.status]}`}
                        >
                          <span
                            className={`size-1.5 rounded-full ${
                              person.status === "active"
                                ? "bg-green-700"
                                : "bg-yellow-700"
                            }`}
                          />
                          {person.statusLabel}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          className="text-sm font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap"
                        >
                          {person.action}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-center text-xs font-bold uppercase tracking-wide text-grey-500">
              + 4 more certified staff
            </p>
          </div>
        </>
      )}

      <InviteStaffModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        restaurantName={RESTAURANT.name}
      />
    </DashboardShell>
  );
}
