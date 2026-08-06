import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import SectionCard from "../components/ui/SectionCard";
import DashboardShell, { RESTAURANT } from "../components/dashboard/DashboardShell";
import InviteStaffModal from "../components/dashboard/InviteStaffModal";
import iconPlus from "../assets/icon-plus.svg";

function DownloadIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5" />
      <path d="M3.5 15.5v1a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

function SearchIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M16.5 16.5 13 13" />
    </svg>
  );
}

export const STAFF = [
  {
    id: "maria-reyes",
    initials: "MR",
    name: "Maria Reyes",
    email: "person@email.com",
    role: "General Manager",
    employment: "Full-time",
    badgeQr: "AW-MR-3F2K",
    credential: "AW-PDX-8FQ2-K9-01",
    issued: "Mar 4, 2026",
    expires: "Mar 4, 2027",
    status: "active",
    statusLabel: "Active",
    action: "View",
    avatarTone: "teal",
  },
  {
    id: "daniel-kim",
    initials: "DK",
    name: "Daniel Kim",
    email: "person@email.com",
    role: "Head Chef",
    employment: "Full-time",
    badgeQr: "AW-DK-7H4M",
    credential: "AW-PDX-8FQ2-K9-02",
    issued: "Mar 4, 2026",
    expires: "Mar 4, 2027",
    status: "renew",
    statusLabel: "Renew in 24d",
    action: "Renew",
    avatarTone: "teal",
  },
  {
    id: "amara-okafor",
    initials: "AO",
    name: "Amara Okafor",
    email: "person@email.com",
    role: "Server",
    employment: "Part-time",
    badgeQr: "AW-AD-9P1Q",
    credential: "AW-PDX-8FQ2-K9-03",
    issued: "Mar 4, 2026",
    expires: "Mar 4, 2027",
    status: "active",
    statusLabel: "Active",
    action: "View",
    avatarTone: "teal",
  },
  {
    id: "luis-soto",
    initials: "LS",
    name: "Luis Soto",
    email: "person@email.com",
    role: "Line Cook",
    employment: "Full-time",
    badgeQr: "AW-LS-2W5N",
    credential: "AW-PDX-8FQ2-K9-04",
    issued: "Mar 4, 2026",
    expires: "Mar 4, 2027",
    status: "active",
    statusLabel: "Active",
    action: "View",
    avatarTone: "teal",
  },
  {
    id: "hannah-tran",
    initials: "HT",
    name: "Hannah Tran",
    email: "person@email.com",
    role: "Server",
    employment: "Part-time",
    badgeQr: "AW-HT-6V8B",
    credential: "AW-PDX-8FQ2-K9-05",
    issued: "Mar 4, 2026",
    expires: "Mar 4, 2027",
    status: "active",
    statusLabel: "Active",
    action: "View",
    avatarTone: "teal",
  },
  {
    id: "jamal-carter",
    initials: "JC",
    name: "Jamal Carter",
    email: "jamal.c@email.com",
    sentLabel: "sent May 28",
    role: "Bartender",
    employment: "Full-time",
    badgeQr: null,
    credential: null,
    issued: null,
    expires: null,
    status: "renew",
    statusLabel: "Renew in 24d",
    action: "View",
    avatarTone: "yellow",
  },
  {
    id: "sofia-klein",
    initials: "SK",
    name: "Sofia Klein",
    email: "person@email.com",
    sentLabel: "sent today",
    role: "Server",
    employment: "Part-time",
    badgeQr: null,
    credential: null,
    issued: null,
    expires: null,
    status: "renew",
    statusLabel: "Renew in 24d",
    action: "View",
    avatarTone: "yellow",
  },
];

const STATUS_STYLES = {
  active: "text-green-700",
  renew: "text-yellow-700",
};

const AVATAR_TONES = {
  teal: "bg-teal-100 text-teal-700",
  yellow: "bg-yellow-100 text-yellow-700",
};

export default function Staff() {
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <DashboardShell activeNav="staff">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            Staff
          </h1>
          <p className="text-base text-grey-600">
            9 certified &middot; 1 renewal coming up &middot; 1 pending invite
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm">
            <DownloadIcon className="size-4" />
            Export .CSV
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={iconPlus}
            onClick={() => setInviteOpen(true)}
          >
            Invite staff
          </Button>
        </div>
      </div>

      <div className="relative w-full max-w-[560px]">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-grey-400" />
        <input
          type="text"
          placeholder="Name, role, etc..."
          className="w-full rounded-lg border border-grey-300 bg-white pl-11 pr-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
        />
      </div>

      <SectionCard title="Staff & credentials">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
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
                  Issued / Expires
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Status
                </th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {STAFF.map((person) => (
                <tr key={person.name} className="border-t border-grey-300">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`flex items-center justify-center size-8 rounded-full text-xs font-bold shrink-0 ${AVATAR_TONES[person.avatarTone]}`}
                      >
                        {person.initials}
                      </div>
                      <div className="flex flex-col">
                        <p className="text-base text-teal-950 whitespace-nowrap">
                          {person.name}
                        </p>
                        <p className="text-sm text-grey-500 whitespace-nowrap">
                          {person.email}
                          {person.sentLabel ? ` \u00b7 ${person.sentLabel}` : ""}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                    {person.role}
                  </td>
                  <td className="px-3 py-3">
                    {person.badgeQr ? (
                      <span className="inline-flex rounded-md bg-teal-050 px-2.5 py-1 text-sm font-semibold text-teal-700 whitespace-nowrap">
                        {person.badgeQr}
                      </span>
                    ) : (
                      <span className="text-base text-grey-400">&mdash;</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                    {person.credential ?? (
                      <span className="text-grey-400">Pending</span>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {person.issued ? (
                      <div className="flex flex-col">
                        <span className="text-base text-teal-950">
                          {person.issued}
                        </span>
                        <span className="text-sm text-grey-500">
                          {person.expires}
                        </span>
                      </div>
                    ) : (
                      <span className="text-base text-grey-400">&mdash;</span>
                    )}
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
                    <Link
                      to={`/dashboard/staff/${person.id}`}
                      className="text-sm font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap"
                    >
                      {person.action}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <InviteStaffModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        restaurantName={RESTAURANT.name}
      />
    </DashboardShell>
  );
}
