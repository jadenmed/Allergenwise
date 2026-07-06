import Badge from "./ui/Badge";
import Button from "./ui/Button";
import CheckItem from "./ui/CheckItem";
import { useInView } from "../hooks/useInView";

const PLANS = [
  {
    name: "Per-Staff",
    description:
      "For independent restaurants certifying their team one credential at a time",
    price: "$29",
    unit: "/ staff",
    sub: "One-time · 12-month validity",
    checks: [
      "All 5 modules + proctored exam",
      "Individual certificate & badge QR",
      "One window seal · public listing",
    ],
    highlighted: false,
  },
  {
    name: "Team Annual",
    description:
      "For full-service restaurants certifying their whole team — best value per staff.",
    price: "$19",
    unit: "/ staff / yr",
    sub: "10-staff minimum · auto-renew",
    checks: [
      "Everything in Per-Staff",
      "30-day renewal reminders",
      "Replacement seals included",
    ],
    highlighted: true,
  },
];

export default function Pricing() {
  const [headingRef, headingInView] = useInView();
  const [cardsRef, cardsInView] = useInView();

  return (
    <section className="w-full flex flex-col items-center justify-center bg-teal-050 px-4 sm:px-6 lg:px-12 py-16 lg:py-24">
      <div className="w-full max-w-[1200px] flex flex-col items-center gap-10">
        <div
          ref={headingRef}
          className={`flex flex-col items-center gap-4 max-w-[560px] text-center ${headingInView ? "anim-fade-up" : "opacity-0"}`}
        >
          <Badge>Pricing</Badge>
          <h2 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight sm:leading-[48px] text-teal-950">
            Per-Staff, with Volume Pricing for Teams
          </h2>
          <p className="text-base leading-6 text-grey-900">
            Pricing is per individual certified staff member. Each credential
            includes the course, exam, certificate, badge QR, and 12 months
            of public verification.
          </p>
        </div>
        <div ref={cardsRef} className="flex flex-col lg:flex-row gap-8 items-stretch w-full">
          {PLANS.map(({ name, description, price, unit, sub, checks, highlighted }, i) => (
            <div
              key={name}
              className={`relative flex-1 min-w-0 flex flex-col gap-8 items-start rounded-2xl bg-white p-8 ${
                highlighted
                  ? "border-2 border-teal-700"
                  : "border border-grey-300"
              } ${cardsInView ? "anim-fade-up" : "opacity-0"}`}
              style={{ animationDelay: `${i * 120}ms` }}
            >
              {highlighted && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge tone="tealSolid">Most Popular</Badge>
                </div>
              )}
              <div className="flex flex-col gap-4 items-start w-full">
                <h3 className="font-serif font-semibold text-2xl leading-8 text-teal-950 w-full">
                  {name}
                </h3>
                <p className="text-base leading-6 text-grey-800 w-full">
                  {description}
                </p>
                <div className="flex items-baseline gap-1 w-full">
                  <span className="font-serif font-semibold text-5xl leading-none text-teal-950">
                    {price}
                  </span>
                  <span className="text-base text-grey-600">{unit}</span>
                </div>
                <p className="text-sm text-grey-600 w-full">{sub}</p>
              </div>
              <div className="flex flex-col gap-3 items-start w-full">
                {checks.map((check) => (
                  <CheckItem key={check}>{check}</CheckItem>
                ))}
              </div>
              <Button
                variant={highlighted ? "primary" : "outline"}
                className="w-full justify-center mt-auto"
              >
                Start with one
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
