import Badge from "./ui/Badge";
import magnifyingGlass from "../assets/magnifying-glass.svg";

const CATEGORIES = [
  "All articles",
  "Compliance",
  "Kitchen practice",
  "For diners",
  "Operations",
  "Case studies",
];

export default function JournalHero({
  activeCategory,
  onCategoryChange,
  searchValue,
  onSearchChange,
}) {
  return (
    <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 pt-10 sm:pt-14 lg:pt-16 pb-10">
      <div className="w-full max-w-[1200px] flex flex-col gap-6 items-start">
        <Badge>The AllergenWise journal</Badge>
        <div className="flex flex-col gap-2 items-start w-full max-w-[720px]">
          <h1 className="font-serif font-semibold text-3xl sm:text-4xl lg:text-[44px] leading-tight lg:leading-[52px] text-teal-950">
            Insights from the Front of House and the Kitchen
          </h1>
          <p className="text-base sm:text-lg leading-7 text-grey-900">
            Practical guides on allergen safety — for restaurant owners,
            certified staff, and the families they serve.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full max-w-[440px] rounded-md border border-grey-400 bg-white px-4 py-2.5">
          <img src={magnifyingGlass} alt="" className="size-5 opacity-60" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search articles by topic, allergen, ..."
            className="flex-1 min-w-0 text-base text-teal-950 placeholder:text-grey-500 outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-3 items-center w-full">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => onCategoryChange(category)}
              className={`inline-flex items-center justify-center rounded-md px-4 py-2.5 text-base font-semibold border transition-colors cursor-pointer ${
                activeCategory === category
                  ? "bg-teal-700 text-white border-teal-700"
                  : "bg-white text-teal-950 border-grey-400 hover:bg-grey-100"
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
