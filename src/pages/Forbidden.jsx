import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";

const NAV_LINKS = [
  { label: "Home", to: "/" },
  { label: "For restaurants", to: "/for-restaurants" },
  { label: "For diners", to: "/for-diners" },
  { label: "Resources", to: "/resources" },
  { label: "Pricing", to: "/pricing" },
];

function AuthedHeader() {
  return (
    <header className="w-full sticky top-0 z-50 flex flex-col items-center backdrop-blur-[3px] bg-white/88 border-b border-grey-300">
      <div className="w-full bg-teal-800 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-12">
        <div className="w-full max-w-[1200px] py-2 text-center">
          <p className="text-sm sm:text-base font-semibold text-teal-050">
            Announcement banner lorem ipsum anything goes{" "}
            <span className="underline text-green-200">here</span>
          </p>
        </div>
      </div>
      <div className="w-full flex flex-col items-center px-4 sm:px-6 lg:px-12">
        <div className="w-full max-w-[1200px] flex items-center gap-6 py-3">
          <div className="flex flex-1 items-center gap-4">
            <Logo />
            <nav className="hidden lg:flex items-center gap-3">
              {NAV_LINKS.map(({ label, to }) => (
                <Link
                  key={label}
                  to={to}
                  className="pb-0.5 text-base text-grey-800 hover:text-teal-700"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="hidden lg:flex items-center gap-3">
            <Button variant="outline" size="sm">
              Verify a certificate
            </Button>
            <div className="flex items-center gap-2 pr-1">
              <div className="flex items-center justify-center size-8 rounded-full bg-teal-100 text-sm font-semibold text-teal-700">
                DK
              </div>
              <span className="text-sm font-semibold text-teal-950">
                Daniel Kim
              </span>
            </div>
            <Link to="/dashboard">
              <Button variant="primary" size="sm">
                Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

const INFO_ITEMS = [
  { label: "Signed in as", value: "Daniel Kim \u00b7 daniel.kim@gardentable.co" },
  { label: "Your role", value: "Staff \u00b7 Head Chef" },
  { label: "You tried to open", value: "/dashboard/billing", tone: "red" },
  { label: "Required role", value: "Owner or Billing admin" },
];

export default function Forbidden() {
  return (
    <>
      <AuthedHeader />
      <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 py-20 lg:py-28">
        <div className="w-full max-w-[600px] flex flex-col items-center gap-6 text-center">
          <Badge tone="red">403 &middot; Access denied</Badge>
          <p className="font-serif font-bold text-[140px] leading-none text-teal-950">
            403
          </p>
          <div className="flex flex-col gap-2">
            <h1 className="font-serif font-semibold text-3xl text-teal-950">
              You don&rsquo;t have permission to view this page.
            </h1>
            <p className="text-base text-grey-600 max-w-[480px]">
              This area is restricted to certain roles. If you think this is
              a mistake, contact your restaurant owner or our support team.
            </p>
          </div>

          <div className="w-full rounded-2xl border border-grey-300 bg-white p-6 shadow-sm text-left">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {INFO_ITEMS.map(({ label, value, tone }) => (
                <div key={label} className="flex flex-col gap-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                    {label}
                  </p>
                  <p
                    className={`text-base font-semibold ${
                      tone === "red" ? "text-red-600" : "text-teal-950"
                    }`}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-4 items-center justify-center">
            <Link to="/portal">
              <Button variant="primary" size="lg" className="bg-teal-900 hover:bg-teal-950">
                Back to my profile
              </Button>
            </Link>
            <Button variant="outline" size="lg">
              Contact support
            </Button>
          </div>

          <p className="text-sm text-grey-500 max-w-[480px]">
            Access denials are logged for security purposes.
          </p>
        </div>
      </section>
    </>
  );
}
