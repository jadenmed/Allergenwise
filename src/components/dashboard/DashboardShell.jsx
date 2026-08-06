import { Link } from "react-router-dom";
import Logo from "../Logo";

export const RESTAURANT = {
  name: "The Garden Table",
  status: "active",
  staffCertifiedCount: 9,
  staffTotalCount: 9,
  credentialId: "AW-PDX-8FQ2-K9",
  issued: "Mar 4, 2026",
  validThrough: "Mar 4, 2027",
  diner30dViews: "1.4k",
};

export const OWNER = { name: "Maria Reyes", initials: "MR", role: "Owner" };

const NAV_ITEMS = [
  { key: "overview", label: "Overview", icon: "grid", to: "/dashboard" },
  { key: "staff", label: "Staff", icon: "people", to: "/dashboard/staff" },
  { key: "billing", label: "Billing", icon: "card", to: "/dashboard/billing" },
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

export default function DashboardShell({ activeNav = "overview", children }) {
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
                const isActive = item.key === activeNav;
                const className = `flex items-center gap-3 rounded-lg px-3 py-2.5 text-base font-semibold text-left cursor-pointer ${
                  isActive
                    ? "bg-teal-700 text-white"
                    : "text-teal-950 hover:bg-grey-100"
                }`;
                const content = (
                  <>
                    <Icon className="size-5 shrink-0" />
                    {item.label}
                  </>
                );
                return item.to ? (
                  <Link key={item.key} to={item.to} className={className}>
                    {content}
                  </Link>
                ) : (
                  <button key={item.key} type="button" className={className}>
                    {content}
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
          {children}
        </main>
      </div>
    </div>
  );
}
