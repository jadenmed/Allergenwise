import Logo from "./Logo";
import Button from "./ui/Button";

const NAV_LINKS = ["Home", "For restaurants", "For diners", "Resources"];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 flex flex-col items-center backdrop-blur-[3px] bg-white/88 border-b border-grey-300">
      <div className="w-full bg-teal-800 flex flex-col items-center justify-center px-12">
        <div className="w-full max-w-[1200px] py-2 text-center">
          <p className="text-base font-semibold text-teal-050">
            Announcement banner lorem ipsum anything goes{" "}
            <span className="underline text-green-200">here</span>
          </p>
        </div>
      </div>

      <div className="w-full flex flex-col items-center px-12">
        <div className="w-full max-w-[1200px] flex items-center gap-8 py-3.5">
          <div className="flex flex-1 items-center gap-6">
            <Logo />
            <nav className="flex items-center gap-4">
              {NAV_LINKS.map((label) => (
                <a
                  key={label}
                  href="#"
                  className="pb-0.5 text-base text-grey-800 hover:text-teal-700"
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm">
              Verify a certificate
            </Button>
            <Button variant="primary" size="sm">
              Get certified
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
