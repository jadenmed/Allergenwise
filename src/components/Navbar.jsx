import { useState } from "react";
import { Link } from "react-router-dom";
import Logo from "./Logo";
import Button from "./ui/Button";

const NAV_LINKS = [
  { label: "Home", to: "/" },
  { label: "For restaurants", to: "/for-restaurants" },
  { label: "For diners", to: "/for-diners" },
  { label: "Resources", to: "#" },
];

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="w-full sticky top-0 z-50 flex flex-col items-center backdrop-blur-[3px] bg-white/88 border-b border-grey-300 anim-slide-down">
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
            <Button variant="primary" size="sm">
              Get certified
            </Button>
          </div>
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex lg:hidden items-center justify-center size-10 rounded-md text-teal-950 hover:bg-grey-100 cursor-pointer"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-6"
            >
              {menuOpen ? (
                <path d="M18 6 6 18M6 6l12 12" />
              ) : (
                <path d="M3 6h18M3 12h18M3 18h18" />
              )}
            </svg>
          </button>
        </div>

        {menuOpen && (
          <div className="w-full max-w-[1200px] flex lg:hidden flex-col gap-1 pb-4">
            <nav className="flex flex-col items-start gap-1">
              {NAV_LINKS.map(({ label, to }) => (
                <Link
                  key={label}
                  to={to}
                  onClick={() => setMenuOpen(false)}
                  className="w-full py-2 text-base text-grey-800 hover:text-teal-700"
                >
                  {label}
                </Link>
              ))}
            </nav>
            <div className="flex flex-col gap-3 pt-3">
              <Button variant="outline" size="sm" className="w-full justify-center">
                Verify a certificate
              </Button>
              <Button variant="primary" size="sm" className="w-full justify-center">
                Get certified
              </Button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
