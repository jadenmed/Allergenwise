import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import CheckItem from "../components/ui/CheckItem";
import checkFat from "../assets/check-fat.svg";

const PLANS = [
  {
    name: "Per-Staff",
    description:
      "For independent restaurants certifying their team one credential at a time",
    price: "$29",
    unit: "/ staff",
    sub: "One-time \u00b7 12-month validity",
    checks: [
      "All 5 modules + proctored exam",
      "Individual certificate & badge QR",
      "One window seal \u00b7 public listing",
    ],
    cta: "Start with one",
    highlighted: false,
  },
  {
    name: "Team Annual",
    description:
      "For full-service restaurants certifying their whole team \u2014 best value per staff.",
    price: "$19",
    unit: "/ staff / yr",
    sub: "10-staff minimum \u00b7 auto-renew",
    checks: [
      "Everything in Per-Staff",
      "30-day renewal reminders",
      "Replacement seals included",
    ],
    cta: "Enroll your team",
    highlighted: true,
  },
];

const FEATURES = [
  { feature: "Course + proctored exam", perStaff: true, teamAnnual: true },
  {
    feature: "Individual credentials + badge QR",
    perStaff: true,
    teamAnnual: true,
  },
  { feature: "Public verification listing", perStaff: true, teamAnnual: true },
  { feature: "Owner dashboard", perStaff: true, teamAnnual: true },
  {
    feature: "Replacement seals",
    perStaff: "Pay per pack",
    teamAnnual: "Included",
  },
  { feature: "SSO", perStaff: false, teamAnnual: true },
];

function FeatureCell({ value }) {
  if (value === true) {
    return (
      <div className="flex justify-center">
        <img src={checkFat} alt="Included" className="size-[18px]" />
      </div>
    );
  }
  if (value === false) {
    return <p className="text-center text-grey-500">&mdash;</p>;
  }
  return (
    <p
      className={`text-center text-sm ${
        value === "Included" ? "font-semibold text-teal-700" : "text-grey-500"
      }`}
    >
      {value}
    </p>
  );
}

export default function Pricing() {
  return (
    <section className="w-full flex flex-col items-center bg-teal-050 px-4 sm:px-6 lg:px-12 py-16 lg:py-24">
      <div className="w-full max-w-[1200px] flex flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-4 max-w-[560px] text-center">
          <Badge>Pricing</Badge>
          <h1 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight sm:leading-[48px] text-teal-950">
            Per-staff Pricing, Restaurant-level Billing
          </h1>
          <p className="text-base leading-6 text-grey-900">
            You&apos;re billed for each individual certified staff member.
            Choose the plan that fits how you&apos;ll operate.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 items-stretch w-full">
          {PLANS.map(
            ({ name, description, price, unit, sub, checks, cta, highlighted }) => (
              <div
                key={name}
                className={`relative flex-1 min-w-0 flex flex-col gap-8 items-start rounded-2xl bg-white p-8 ${
                  highlighted
                    ? "border-2 border-teal-700"
                    : "border border-grey-300"
                }`}
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
                  {cta}
                </Button>
              </div>
            )
          )}
        </div>

        <div className="w-full rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-5">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
            Feature comparison
          </p>
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="bg-teal-050">
                  <th className="text-left text-xs font-bold uppercase tracking-wide text-teal-700 px-3 py-3">
                    Feature
                  </th>
                  <th className="text-center text-xs font-bold uppercase tracking-wide text-teal-700 px-3 py-3 w-[140px]">
                    Per-Staff
                  </th>
                  <th className="text-center text-xs font-bold uppercase tracking-wide text-teal-700 px-3 py-3 w-[140px]">
                    Team Annual
                  </th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((row) => (
                  <tr key={row.feature} className="border-t border-grey-300">
                    <td className="px-3 py-4 text-base text-teal-950">
                      {row.feature}
                    </td>
                    <td className="px-3 py-4">
                      <FeatureCell value={row.perStaff} />
                    </td>
                    <td className="px-3 py-4">
                      <FeatureCell value={row.teamAnnual} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
