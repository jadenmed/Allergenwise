import Badge from "./ui/Badge";
import { useInView } from "../hooks/useInView";

const ICON_PATHS = {
  layout: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 9v12" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 9h18" />
    </>
  ),
  shield: (
    <path d="M12 2 4 5v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5l-8-3Zm-1.5 11.5L8 11l1.4-1.4 1.1 1.1 3.1-3.1L15 9Z" />
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z" />
    </>
  ),
  activity: <path d="M22 12h-4l-3 9-6-18-3 9H2" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
};

const FEATURES = [
  {
    icon: "layout",
    title: "the 5-Module Course",
    body: "Self-paced training on allergens, cross-contact, FOH procedure, sanitation, and emergency response.",
  },
  {
    icon: "calendar",
    title: "Proctored Certification Exam",
    body: "AI-proctored online exam. Pass at 80% to earn an individual, ID-verified credential.",
  },
  {
    icon: "shield",
    title: "Tamper-Evident Window Seal",
    body: "QR-coded window decal tied to your live registry record. Each seal is uniquely serialized.",
  },
  {
    icon: "qr",
    title: "Per-Staff Badge QR",
    body: "Each certified staff member gets a personal badge QR. Diners and inspectors verify the individual, not just the venue.",
  },
  {
    icon: "activity",
    title: "Owner Dashboard",
    body: "Track certification status, manage staff, see renewals 30 days out, and pull verification analytics.",
  },
  {
    icon: "search",
    title: "Public Discovery Listing",
    body: "Verified restaurants appear in the AllergenWise diner search — filterable by allergen and neighborhood.",
  },
];

export default function FeaturesGrid() {
  const [headingRef, headingInView] = useInView();
  const [cardsRef, cardsInView] = useInView();

  return (
    <section className="w-full flex flex-col items-center justify-center bg-white px-4 sm:px-6 lg:px-12 py-16 lg:py-24">
      <div className="w-full max-w-[1200px] flex flex-col items-center gap-10">
        <div
          ref={headingRef}
          className={`flex flex-col items-center gap-4 max-w-[520px] text-center ${headingInView ? "anim-fade-up" : "opacity-0"}`}
        >
          <Badge>What's Included</Badge>
          <h2 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight sm:leading-[48px] text-teal-950">
            Everything to Operate a Credentialed Kitchen
          </h2>
          <p className="text-base leading-6 text-grey-900">
            Restaurants train and certify their team. Diners verify the result
            instantly. the same record powers both.
          </p>
        </div>
        <div ref={cardsRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
          {FEATURES.map(({ icon, title, body }, i) => (
            <div
              key={title}
              className={`flex flex-col gap-6 items-start rounded-2xl border border-grey-300 bg-white p-8 hover:-translate-y-1 hover:shadow-lg transition-[transform,box-shadow] duration-300 ${cardsInView ? "anim-fade-up" : "opacity-0"}`}
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="flex items-center justify-center rounded-lg size-11 bg-teal-050">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-6 text-teal-700"
                >
                  {ICON_PATHS[icon]}
                </svg>
              </div>
              <div className="flex flex-col gap-3 items-start w-full">
                <h3 className="font-serif font-semibold text-xl leading-8 text-teal-950 w-full">
                  {title}
                </h3>
                <p className="text-base leading-6 text-grey-800 w-full">
                  {body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
