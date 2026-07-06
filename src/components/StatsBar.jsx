import pattern from "../assets/pattern.png";
import { useInView } from "../hooks/useInView";

const STATS = [
  { value: "2,840+", label: "Restaurants certified" },
  { value: "31,200", label: "Staff trained" },
  { value: "1.4M", label: "Diner verifications" },
  { value: "< 2s", label: "Median time to verify" },
];

export default function StatsBar() {
  const [ref, inView] = useInView();

  return (
    <section className="relative w-full flex items-center justify-center overflow-hidden bg-teal-800 px-4 sm:px-6 lg:px-12 py-8">
      <img
        src={pattern}
        alt=""
        className="absolute z-0 top-0 left-1/2 -translate-x-1/2 w-[800px] max-w-none object-cover pointer-events-none"
      />
      <div ref={ref} className="relative z-10 w-full max-w-[1200px] grid grid-cols-2 lg:flex lg:flex-wrap items-center justify-center gap-6">
        {STATS.map(({ value, label }, i) => (
          <div
            key={label}
            className={`flex lg:flex-1 lg:min-w-[160px] flex-col items-center ${inView ? "anim-fade-up" : "opacity-0"}`}
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <p className="font-serif font-semibold text-3xl sm:text-[40px] leading-tight sm:leading-[52px] text-white text-center">
              {value}
            </p>
            <p className="text-sm font-semibold text-teal-100 text-center">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
