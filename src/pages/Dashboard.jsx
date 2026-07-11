import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import iconPlus from "../assets/icon-plus.svg";

const RESTAURANT = {
  name: "The Garden Table",
  staffCertifiedCount: 9,
  staffTotalCount: 9,
  credentialId: "AW-PDX-8FQ2-K9",
  issued: "Mar 4, 2026",
  validThrough: "Mar 4, 2027",
  diner30dViews: "1.4k",
};

const OWNER = { name: "Maria Reyes", initials: "MR", role: "Owner" };

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

const NAV_ITEMS = [
  { key: "overview", label: "Overview", icon: "grid" },
  { key: "staff", label: "Staff", icon: "people" },
  { key: "billing", label: "Billing", icon: "card" },
];

function GridIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  );
}

function PeopleIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="7" cy="7" r="2.5" />
      <path d="M2.5 16c.5-3 2.2-4.5 4.5-4.5s4 1.5 4.5 4.5" />
      <circle cx="14" cy="7.5" r="2" />
      <path d="M12.5 11.5c1.8.3 3 1.6 3.5 4" />
    </svg>
  );
}

function CardIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="M2.5 8h15" />
      <path d="M5 12h4" />
    </svg>
  );
}

function SignOutIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7 17.5H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1h3" />
      <path d="M13 14l4-4-4-4" />
      <path d="M17 10H7" />
    </svg>
  );
}

const NAV_ICONS = { grid: GridIcon, people: PeopleIcon, card: CardIcon };

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

export default function Dashboard() {
  return (
    <div className="w-full min-h-screen flex flex-col bg-grey-100">
      <header className="w-full flex items-center justify-between gap-4 border-b border-grey-300 bg-white px-4 sm:px-6 py-4">
        <div className="flex items-center gap-4 min-w-0">
          <Logo className="shrink-0" />
          <div className="hidden sm:block h-6 w-px bg-grey-300 shrink-0" />
          <p className="hidden sm:block text-base text-grey-600 truncate">
            Owner Dashboard
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center justify-center size-9 rounded-full bg-teal-100 text-xs font-bold text-teal-700">
            {OWNER.initials}
          </div>
          <p className="text-base text-teal-950">{OWNER.name}</p>
        </div>
      </header>

      <div className="w-full flex flex-1">
        <aside className="hidden lg:flex w-[280px] shrink-0 flex-col justify-between border-r border-grey-300 bg-white px-4 py-6">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2 rounded-xl bg-teal-050 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Restaurant
              </p>
              <p className="text-lg font-semibold text-teal-950">
                {RESTAURANT.name}
              </p>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-green-700">
                <span className="size-1.5 rounded-full bg-green-700" />
                Active &middot; {RESTAURANT.staffCertifiedCount}/
                {RESTAURANT.staffTotalCount} certified
              </p>
            </div>

            <nav className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                const isActive = item.key === "overview";
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-base font-semibold text-left cursor-pointer ${
                      isActive
                        ? "bg-teal-700 text-white"
                        : "text-teal-950 hover:bg-grey-100"
                    }`}
                  >
                    <Icon className="size-5 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex flex-col gap-4">
            <div className="border-t border-grey-300 pt-4">
              <button
                type="button"
                className="flex items-center gap-2 text-base font-semibold text-red-600 cursor-pointer"
              >
                <SignOutIcon className="size-5" />
                Sign out
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-9 rounded-full bg-teal-100 text-xs font-bold text-teal-700 shrink-0">
                {OWNER.initials}
              </div>
              <div className="flex flex-col">
                <p className="text-sm font-semibold text-teal-950">
                  {OWNER.name}
                </p>
                <p className="text-xs text-grey-500">
                  {OWNER.role} &middot; {RESTAURANT.name}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 flex flex-col gap-6 px-4 sm:px-6 lg:px-10 py-8 min-w-0">
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
            <Button variant="outline" size="sm" icon={iconPlus}>
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

              <Link to={`/verify/${RESTAURANT.credentialId}`} className="self-start">
                <Button variant="outline" size="sm">
                  View public verification page
                </Button>
              </Link>
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
        </main>
      </div>
    </div>
  );
}
