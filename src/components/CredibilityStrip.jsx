const ITEMS = [
  "FDA Food Code aligned",
  "HACCP principles",
  "ANAB-accredited program",
  "FARE-recognized",
];

export default function CredibilityStrip() {
  return (
    <section className="w-full flex items-center justify-center bg-white border-y border-grey-300 px-12 py-8">
      <div className="w-full max-w-[1200px] flex flex-wrap items-center justify-center gap-6 font-bold">
        <p className="text-base uppercase text-grey-600">
          Built to the standards diners trust
        </p>
        {ITEMS.map((item) => (
          <p key={item} className="text-lg text-teal-900">
            {item}
          </p>
        ))}
      </div>
    </section>
  );
}
