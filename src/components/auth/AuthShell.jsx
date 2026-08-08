import { Link } from "react-router-dom";
import Logo from "../Logo";
import Badge from "../ui/Badge";
import Button from "../ui/Button";

export function AuthHeader({ label, to }) {
  return (
    <header className="w-full flex flex-col items-center border-b border-grey-300 bg-white px-4 sm:px-6 lg:px-12">
      <div className="w-full max-w-[1200px] flex items-center justify-between gap-4 py-4">
        <Link to="/">
          <Logo />
        </Link>
        <Link to={to}>
          <Button variant="outline" size="sm">
            {label}
          </Button>
        </Link>
      </div>
    </header>
  );
}

export default function AuthShell({
  headerLabel,
  headerTo,
  badge,
  heading,
  description,
  features,
  children,
}) {
  return (
    <div className="w-full min-h-screen flex flex-col">
      <AuthHeader label={headerLabel} to={headerTo} />

      <div className="w-full flex flex-1 flex-col lg:flex-row">
        <div className="hidden lg:flex w-[480px] shrink-0 flex-col justify-between bg-gradient-to-b from-teal-800 to-teal-950 px-10 py-12 text-white">
          <div className="flex flex-col gap-6">
            <Badge tone="white" className="self-start">
              {badge}
            </Badge>
            <h1 className="font-serif font-semibold text-4xl leading-tight">
              {heading}
            </h1>
            <p className="text-base text-teal-100 leading-relaxed">
              {description}
            </p>

            <div className="flex flex-col gap-5 mt-4">
              {features.map((feature) => (
                <div key={feature.title} className="flex items-start gap-3">
                  <div className="flex items-center justify-center size-9 rounded-full bg-white/10 shrink-0">
                    <feature.icon className="size-5" />
                  </div>
                  <div className="flex flex-col">
                    <p className="text-base font-semibold">{feature.title}</p>
                    <p className="text-sm text-teal-100">
                      {feature.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-sm text-teal-200">
            &copy; 2026 AllergenWise &middot; a talentMLS program
          </p>
        </div>

        <div className="flex flex-1 items-center justify-center bg-grey-100 px-4 sm:px-6 py-12">
          <div className="w-full max-w-[440px] flex flex-col gap-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
