import Badge from "./ui/Badge";
import { useInView } from "../hooks/useInView";

const STEPS = [
  {
    number: "1",
    title: "Look for the Seal",
    body: "Certified restaurants display a tamper-evident window decal with a unique QR code at the entrance.",
  },
  {
    number: "2",
    title: "Scan with Your Camera",
    body: "Open your phone's regular camera — no app needed — and point at the QR code. Tap the link that appears.",
  },
  {
    number: "3",
    title: "Read the Green Seal",
    body: "If you see green, the certification is current. Amber means it's expiring. Red means it's lapsed — ask staff directly.",
  },
];

export default function VerifySteps() {
  const [headingRef, headingInView] = useInView();
  const [cardsRef, cardsInView] = useInView();

  return (
    <section className="w-full flex flex-col items-center justify-center bg-grey-100 px-4 sm:px-6 lg:px-12 py-16 lg:py-24">
      <div className="w-full max-w-[1200px] flex flex-col items-center gap-10">
        <div
          ref={headingRef}
          className={`flex flex-col items-center gap-4 max-w-[520px] text-center ${headingInView ? "anim-fade-up" : "opacity-0"}`}
        >
          <Badge>How verification works</Badge>
          <h2 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight sm:leading-[48px] text-teal-950">
            Two Seconds, No Account, No App
          </h2>
        </div>
        <div ref={cardsRef} className="flex flex-col sm:flex-row gap-8 items-stretch w-full">
          {STEPS.map(({ number, title, body }, i) => (
            <div
              key={number}
              className={`flex-1 min-w-0 flex flex-col gap-8 items-start rounded-2xl border border-grey-300 bg-white p-8 hover:-translate-y-1 hover:shadow-lg transition-[transform,box-shadow] duration-300 ${cardsInView ? "anim-fade-up" : "opacity-0"}`}
              style={{ animationDelay: `${i * 120}ms` }}
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
