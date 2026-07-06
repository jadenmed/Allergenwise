import benefitsPhones from "../assets/benefits-phones.png";
import checkFatWhite from "../assets/check-fat-white.svg";
import pattern from "../assets/pattern.png";

const POINTS = [
  {
    title: "Real",
    body: "Pulled live from the registry, not a printed certificate that could be faked or out of date.",
  },
  {
    title: "Recent",
    body: 'A clear renewal date and "verified just now" timestamp, so lapsed certs are obvious at a glance.',
  },
  {
    title: "Verified",
    body: "One unmistakable green state. Anything less than fully current never shows the green seal.",
  },
];

export default function Benefits() {
  return (
    <section className="relative w-full flex flex-col items-center justify-center overflow-hidden bg-teal-800 px-12 py-24">
      <img
        src={pattern}
        alt=""
        className="absolute z-0 top-1/2 -translate-y-1/2 right-[calc(50%-600px)] w-[800px] max-w-none opacity-32 object-cover pointer-events-none"
      />
      <div className="relative z-10 w-full max-w-[1200px] flex gap-10 items-start justify-center">
        <div className="flex-1 min-w-0 flex flex-col gap-6 items-start">
          <div className="inline-flex items-center justify-center rounded px-3.5 py-2 text-xs font-bold uppercase text-white bg-teal-700">
            The Moment That Matters
          </div>
          <div className="flex flex-col gap-2 items-start w-full">
            <h2 className="font-serif font-semibold text-[48px] leading-[52px] text-white w-full">
              A Parent at the Door, Two Seconds to Decide
            </h2>
            <p className="text-lg leading-7 text-teal-050 w-full">
              Before the cake comes out, a parent scans the seal on the window.
              AllergenWise is engineered so the answer they need lands instantly —
              no logins, no PDFs, no guessing.
            </p>
          </div>
          <div className="flex flex-col gap-4 items-start max-w-[440px] w-full">
            {POINTS.map(({ title, body }) => (
              <div key={title} className="flex gap-3 items-start w-full">
                <div className="flex items-center p-1.5 rounded-full shrink-0 bg-teal-700">
                  <img src={checkFatWhite} alt="" className="size-3" />
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2 items-start justify-center">
                  <p className="text-lg font-semibold text-white">{title}</p>
                  <p className="text-base text-teal-050 w-full">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="shrink-0 size-[550px]">
          <img
            src={benefitsPhones}
            alt="AllergenWise app showing an instant certification verification"
            className="size-full object-cover pointer-events-none"
          />
        </div>
      </div>
    </section>
  );
}
