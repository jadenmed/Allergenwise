const ITEMS = [
  "FDA Food Code aligned",
  "HACCP principles",
  "ANAB-accredited program",
  "FARE-recognized",
];

export default function CredibilityStrip() {
  return (
    <section className="w-full flex items-center justify-center bg-white border-y border-grey-300 px-4 sm:px-6 lg:px-12 py-8">
      <div className="w-full max-w-[1200px] flex flex-wrap items-center justify-center gap-4 sm:gap-6 font-bold">
        <p className="text-sm sm:text-base uppercase text-grey-600 text-center">
          Built to the standards diners trust
        </p>
        {ITEMS.map((item) => (
          <p key={item} className="text-base sm:text-lg text-teal-900">
            {item}
          </p>
        ))}
      </div>
    </section>
  );
}
