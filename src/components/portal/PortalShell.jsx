import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "../Logo";
import { getLearnerProfile, logout } from "../../lib/api";

function initialsOf(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

const NAV_ITEMS = [
  { key: "profile", label: "My profile", icon: "person", to: "/portal" },
  { key: "course", label: "My course", icon: "doc", to: "/portal/course" },
];

function PersonIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="10" cy="7" r="3" />
      <path d="M3.5 16.5c1-3.5 3.2-5 6.5-5s5.5 1.5 6.5 5" />
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

function SignOutIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7 17.5H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1h3" />
      <path d="M13 14l4-4-4-4" />
      <path d="M17 10H7" />
    </svg>
  );
}

const NAV_ICONS = { person: PersonIcon, doc: DocIcon };

export default function PortalShell({ activeNav = "profile", children }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLearnerProfile()
      .then((res) => {
        if (!cancelled) setProfile(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const fullName = profile?.fullName ?? "";
  const initials = fullName ? initialsOf(fullName) : "";

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      // Fall through — clear the client side regardless of a network error.
    }
    navigate("/sign-in", { replace: true });
  };

  return (
    <div className="w-full min-h-screen flex flex-col bg-grey-100">
      <header className="w-full flex items-center justify-between gap-4 border-b border-grey-300 bg-white px-4 sm:px-6 py-4">
        <div className="flex items-center gap-4 min-w-0">
          <Logo className="shrink-0" />
          <div className="hidden sm:block h-6 w-px bg-grey-300 shrink-0" />
          <p className="hidden sm:block text-base text-grey-600 truncate">
            My Profile
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center justify-center size-9 rounded-full bg-teal-100 text-xs font-bold text-teal-700">
            {initials}
          </div>
          <p className="text-base text-teal-950">{fullName}</p>
        </div>
      </header>

      <div className="w-full flex flex-1">
        <aside className="hidden lg:flex w-[280px] shrink-0 flex-col justify-between border-r border-grey-300 bg-white px-4 py-6">
          <div className="flex flex-col gap-6">
            {profile?.restaurant && (
              <div className="flex flex-col gap-2 rounded-xl bg-teal-050 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                  I work at
                </p>
                <p className="text-lg font-semibold text-teal-950">
                  {profile.restaurant.name}
                </p>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-green-700">
                  <span className="size-1.5 rounded-full bg-green-700" />
                  Active &middot; {profile.staffCounts.certified}/
                  {profile.staffCounts.total} certified
                </p>
              </div>
            )}

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
                onClick={handleSignOut}
                disabled={signingOut}
                className="flex items-center gap-2 text-base font-semibold text-red-600 disabled:opacity-60 cursor-pointer"
              >
                <SignOutIcon className="size-5" />
                {signingOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-9 rounded-full bg-teal-100 text-xs font-bold text-teal-700 shrink-0">
                {initials}
              </div>
              <div className="flex flex-col">
                <p className="text-sm font-semibold text-teal-950">
                  {fullName}
                </p>
                <p className="text-xs text-grey-500">
                  {profile?.jobRole}
                  {profile?.jobRole && profile?.restaurant ? " \u00b7 " : ""}
                  {profile?.restaurant?.name}
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
