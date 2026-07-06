const ALLERGEN_OPTIONS = [
  { label: "Peanut", defaultChecked: true },
  { label: "Tree nut", defaultChecked: true },
  { label: "Dairy" },
  { label: "Egg" },
  { label: "Shellfish" },
  { label: "Soy" },
  { label: "Wheat / gluten" },
];

const CUISINE_OPTIONS = ["American", "Asian", "Italian", "Mediterranean", "Mexican"];

const DISTANCE_OPTIONS = [
  { label: "Any distance", defaultChecked: true },
  { label: "Walking · 0.5 mi" },
  { label: "Nearby · 2 mi" },
  { label: "Citywide · 10 mi" },
];

function FilterCard({ title, children }) {
  return (
    <div className="w-full flex flex-col gap-4 items-start rounded-2xl border border-grey-300 bg-white p-6">
      <p className="text-xs font-bold uppercase tracking-wide text-grey-600">{title}</p>
      <div className="flex flex-col gap-3 items-start w-full">{children}</div>
    </div>
  );
}

export default function RestaurantFilters() {
  return (
    <aside className="w-full lg:w-[232px] shrink-0 flex flex-col gap-6 items-start">
      <FilterCard title="Allergen-safe">
        {ALLERGEN_OPTIONS.map(({ label, defaultChecked }) => (
          <label key={label} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              defaultChecked={defaultChecked}
              className="size-4 rounded accent-teal-700"
            />
            <span className="text-base text-grey-800">{label}</span>
          </label>
        ))}
      </FilterCard>

      <FilterCard title="Cuisine">
        {CUISINE_OPTIONS.map((label) => (
          <label key={label} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="size-4 rounded accent-teal-700" />
            <span className="text-base text-grey-800">{label}</span>
          </label>
        ))}
      </FilterCard>

      <FilterCard title="Distance">
        {DISTANCE_OPTIONS.map(({ label, defaultChecked }) => (
          <label key={label} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="distance"
              defaultChecked={defaultChecked}
              className="size-4 accent-teal-700"
            />
            <span className="text-base text-grey-800">{label}</span>
          </label>
        ))}
      </FilterCard>
    </aside>
  );
}
