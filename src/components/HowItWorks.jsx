import Badge from "./ui/Badge";

const STEPS = [
  {
    number: "1",
    title: "Train & Certify Your Staff",
    body: "Your team completes accredited allergen-safety training covering the major allergens, cross-contact, sanitation, and emergency response, then passes a certification exam.",
  },
  {
    number: "2",
    title: "Earn the Window Seal",
    body: "Certified restaurants receive a tamper-evident window decal with a unique QR code linked to a live certification record.",
  },
  {
    number: "3",
    title: "Diners Verify in Seconds",
    body: "A quick scan shows whether the certification is real, who's certified, and exactly when it was last renewed; no app or account needed.",
  },
];

export default function HowItWorks() {
  return (
    <section className="w-full flex flex-col items-center justify-center bg-grey-100 px-12 py-24">
      <div className="w-full max-w-[1200px] flex flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-4 max-w-[520px] text-center">
          <Badge>How it works</Badge>
          <h2 className="font-serif font-semibold text-4xl leading-[48px] text-teal-950">
            Allergen Training, Certification, and Verification in{" "}
            <span className="text-teal-700">One System</span>
          </h2>
          <p className="text-base leading-6 text-grey-900">
            Restaurants train and certify their team. Diners verify the result
            instantly. the same record powers both.
          </p>
        </div>
        <div className="flex gap-8 items-start w-full">
          {STEPS.map(({ number, title, body }) => (
            <div
              key={number}
              className="flex-1 min-w-0 h-[304px] flex flex-col gap-8 items-start rounded-2xl border border-grey-300 bg-white p-8"
            >
              <div className="flex flex-col items-center justify-center rounded-md size-10 bg-teal-050">
                <p className="font-serif font-semibold text-xl leading-8 text-teal-950 text-center w-full">
                  {number}
                </p>
              </div>
              <div className="flex flex-col gap-3 items-start w-full">
                <h3 className="font-serif font-semibold text-2xl leading-8 text-teal-950 w-full">
                  {title}
                </h3>
                <p className="text-base leading-6 text-grey-800 w-full">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
