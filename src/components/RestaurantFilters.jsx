// Allergen values match the backend's ALLERGEN_SPECIALTIES enum
// (backend/app/api/submissions/create/route.ts) — these are the only
// values a restaurant can actually be tagged with.
export const ALLERGEN_OPTIONS = [
  { label: "Peanut", value: "peanut_free" },
  { label: "Tree nut", value: "tree_nut_aware" },
  { label: "Dairy", value: "dairy_free" },
  { label: "Egg", value: "egg_free" },
  { label: "Shellfish", value: "shellfish_free" },
  { label: "Fish", value: "fish_free" },
  { label: "Soy", value: "soy_free" },
  { label: "Wheat / gluten", value: "gluten_free_menu" },
  { label: "Sesame", value: "sesame_free" },
];

// Cuisine is a free-text column on `restaurants` (no backend enum) — this is
// just a curated shortlist sent as an exact-match filter (GET /api/search
// only supports a single `cuisine` value, so this is single-select).
export const CUISINE_OPTIONS = [
  { label: "All cuisines", value: "" },
  { label: "American", value: "american" },
  { label: "Asian", value: "asian" },
  { label: "Italian", value: "italian" },
  { label: "Mediterranean", value: "mediterranean" },
  { label: "Mexican", value: "mexican" },
];

// radiusMi only has an effect once a ZIP resolves to lat/lng server-side
// (GET /api/search requires 1 <= radiusMi <= 100, so "walking distance"
// rounds up to the smallest value the backend accepts).
export const DISTANCE_OPTIONS = [
  { label: "Any distance", value: 25 },
  { label: "Walking \u00b7 1 mi", value: 1 },
  { label: "Nearby \u00b7 2 mi", value: 2 },
  { label: "Citywide \u00b7 10 mi", value: 10 },
];

function FilterCard({ title, children }) {
  return (
    <div className="w-full flex flex-col gap-4 items-start rounded-2xl border border-grey-300 bg-white p-6">
      <p className="text-xs font-bold uppercase tracking-wide text-grey-600">{title}</p>
      <div className="flex flex-col gap-3 items-start w-full">{children}</div>
    </div>
  );
}

export default function RestaurantFilters({
  allergens,
  onToggleAllergen,
  cuisine,
  onCuisineChange,
  radiusMi,
  onRadiusChange,
}) {
  return (
    <aside className="w-full lg:w-[232px] shrink-0 flex flex-col gap-6 items-start">
      <FilterCard title="Allergen-safe">
        {ALLERGEN_OPTIONS.map(({ label, value }) => (
          <label key={value} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allergens.includes(value)}
              onChange={() => onToggleAllergen(value)}
              className="size-4 rounded accent-teal-700"
            />
            <span className="text-base text-grey-800">{label}</span>
          </label>
        ))}
      </FilterCard>

      <FilterCard title="Cuisine">
        {CUISINE_OPTIONS.map(({ label, value }) => (
          <label key={label} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="cuisine"
              checked={cuisine === value}
              onChange={() => onCuisineChange(value)}
              className="size-4 accent-teal-700"
            />
            <span className="text-base text-grey-800">{label}</span>
          </label>
        ))}
      </FilterCard>

      <FilterCard title="Distance">
        {DISTANCE_OPTIONS.map(({ label, value }) => (
          <label key={label} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="distance"
              checked={radiusMi === value}
              onChange={() => onRadiusChange(value)}
              className="size-4 accent-teal-700"
            />
            <span className="text-base text-grey-800">{label}</span>
          </label>
        ))}
      </FilterCard>
    </aside>
  );
}
