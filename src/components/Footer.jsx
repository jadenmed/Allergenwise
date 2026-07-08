import { Link } from "react-router-dom";
import Logo from "./Logo";
import Button from "./ui/Button";
import pattern from "../assets/pattern.png";
import instagram from "../assets/instagram.svg";
import tiktok from "../assets/tiktok.svg";
import linkedin from "../assets/linkedin.svg";

const RESTAURANT_LINKS = [
  { label: "Home", to: "/" },
  { label: "For restaurants", to: "/for-restaurants" },
  { label: "For diners", to: "/for-diners" },
  { label: "Resources", to: "/resources" },
];
const COURSE_LINKS = [
  { label: "Course", to: "/course" },
  { label: "Find restaurant", to: "/find-restaurant" },
  { label: "Get certified", to: "#" },
];
const SOCIALS = [
  { icon: instagram, label: "Instagram" },
  { icon: tiktok, label: "TikTok" },
  { icon: linkedin, label: "LinkedIn" },
];

export default function Footer() {
  return (
    <footer className="relative w-full flex items-center justify-center overflow-hidden bg-teal-900 px-4 sm:px-6 lg:px-12 pt-16 lg:pt-24 pb-12">
      <div className="relative z-10 w-full max-w-[1200px] flex flex-col gap-10 lg:gap-16 items-start">
        <div className="flex flex-col sm:flex-row gap-8 items-start w-full flex-wrap">
          <div className="flex flex-col gap-10 items-start w-full max-w-[485px]">
            <div className="flex flex-col gap-6 items-start w-full">
              <Logo dark />
              <div className="flex flex-col gap-4 items-start w-full">
                <p className="max-w-[360px] text-lg leading-7 text-white">
                  Accredited allergen-safety certification for restaurants and
                  instant public verification for diners.
                </p>
                <Button size="sm">Get certified</Button>
              </div>
            </div>
            <div className="flex gap-3 items-start">
              {SOCIALS.map(({ icon, label }) => (
                <a
                  key={label}
                  href="#"
                  aria-label={label}
                  className="flex items-center justify-center p-[7px] rounded border border-white bg-white/0 hover:bg-white/10"
                >
                  <img src={icon} alt="" className="size-[18px]" />
                </a>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-[160px] flex flex-col gap-6 items-start">
            <p className="text-lg font-bold text-white">Restaurants</p>
            <nav className="flex flex-col gap-3 items-start py-1.5">
              {RESTAURANT_LINKS.map(({ label, to }) => (
                <Link
                  key={label}
                  to={to}
                  className="pb-0.5 text-base text-grey-100 hover:text-teal-100"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex-1 min-w-[160px] flex flex-col gap-6 items-start">
            <p className="text-lg font-bold text-white">Course & Diners</p>
            <nav className="flex flex-col gap-3 items-start py-1.5">
              {COURSE_LINKS.map(({ label, to }) => (
                <Link
                  key={label}
                  to={to}
                  className="pb-0.5 text-base text-grey-100 hover:text-teal-100"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4 w-full">
          <div className="flex gap-2 items-center">
            <p className="text-sm text-teal-100">© 2026 AllergenWise, Inc.</p>
            <div className="size-[3px] rounded-full bg-teal-100" />
            <p className="text-sm text-teal-100">A TalentMLS Program</p>
          </div>
          <div className="flex gap-2 items-center">
            <a href="#" className="text-sm text-teal-100 hover:text-white">
              Privacy Policy
            </a>
            <div className="size-[3px] rounded-full bg-teal-100" />
            <a href="#" className="text-sm text-teal-100 hover:text-white">
              Terms &amp; Conditions
            </a>
          </div>
        </div>
      </div>

      <img
        src={pattern}
        alt=""
        className="absolute z-0 -bottom-[392px] -right-[280px] w-[800px] max-w-none opacity-32 object-cover pointer-events-none"
      />
    </footer>
  );
}
