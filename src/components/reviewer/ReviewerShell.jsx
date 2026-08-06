import { Link } from "react-router-dom";
import Logo from "../Logo";

export const REVIEWER = { name: "Viv Reviewer", initials: "V", role: "Reviewer" };

export const QUEUE_SUMMARY = { inQueue: 24, needInfo: 3 };

const NAV_ITEMS = [
  { key: "overview", label: "Overview", icon: "grid", to: "/internal" },
  { key: "submissions", label: "Submissions", icon: "doc", to: "/internal/submissions", count: 14 },
  { key: "certifications", label: "Certifications", icon: "shield", to: "/internal/certifications", count: 10 },
  { key: "brands", label: "Brands", icon: "building", to: "/internal/brands" },
  { key: "partners", label: "Partners", icon: "handshake", to: "/internal/partners" },
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

function DocIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5.5 2.5h6l3 3v12h-9z" />
      <path d="M11 2.5v3.5h3.5" />
      <path d="M7.5 11h5M7.5 13.5h5" />
    </svg>
  );
}

function ShieldIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 2.5 16 5v5c0 4-2.6 6.5-6 7.5-3.4-1-6-3.5-6-7.5V5z" />
      <path d="M7.3 10 9.3 12l3.4-4" />
    </svg>
  );
}

function BuildingIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="4" y="2.5" width="9" height="15" rx="1" />
      <path d="M13 8.5h3v9h-3" />
      <path d="M6.5 5.5h1M9.5 5.5h1M6.5 8.5h1M9.5 8.5h1M6.5 11.5h1M9.5 11.5h1" />
    </svg>
  );
}

function HandshakeIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2.5 9 6 6l3 2 2.5-2 2.5 2" />
      <path d="M2.5 9l3.5 4 2-1.5 1.5 1.8a1.3 1.3 0 0 0 2-1.6" />
      <path d="M14 8l3.5 3.5-2 2-4-3.3" />
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

const NAV_ICONS = {
  grid: GridIcon,
  doc: DocIcon,
  shield: ShieldIcon,
  building: BuildingIcon,
  handshake: HandshakeIcon,
};

export default function ReviewerShell({ activeNav = "overview", children }) {
  return (
    <div className="w-full min-h-screen flex flex-col bg-grey-100">
      <header className="w-full flex items-center justify-between gap-4 border-b border-grey-300 bg-white px-4 sm:px-6 py-4">
        <div className="flex items-center gap-4 min-w-0">
          <Logo className="shrink-0" />
          <div className="hidden sm:block h-6 w-px bg-grey-300 shrink-0" />
          <p className="hidden sm:block text-base text-grey-600 truncate">
            Internal Dashboard
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center justify-center size-9 rounded-full bg-teal-100 text-xs font-bold text-teal-700">
            {REVIEWER.initials}
          </div>
          <p className="text-base text-teal-950">
            {REVIEWER.name.split(" ")[0]}
          </p>
        </div>
      </header>

      <div className="w-full flex flex-1">
        <aside className="hidden lg:flex w-[280px] shrink-0 flex-col justify-between border-r border-grey-300 bg-white px-4 py-6">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2 rounded-xl bg-teal-050 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                Reviewer console
              </p>
              <p className="text-lg font-semibold text-teal-950">
                Internal review
              </p>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-teal-700">
                <span className="size-1.5 rounded-full bg-teal-700" />
                {QUEUE_SUMMARY.inQueue} in queue &middot; {QUEUE_SUMMARY.needInfo} need info
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
                    {typeof item.count === "number" && (
                      <span
                        className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${
                          isActive ? "bg-teal-800 text-white" : "bg-grey-100 text-grey-600"
                        }`}
                      >
                        {item.count}
                      </span>
                    )}
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
                {REVIEWER.initials}
              </div>
              <div className="flex flex-col">
                <p className="text-sm font-semibold text-teal-950">
                  {REVIEWER.name}
                </p>
                <p className="text-xs text-grey-500">{REVIEWER.role}</p>
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
