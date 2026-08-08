import { useEffect, useState } from "react";
import magnifyingGlass from "../assets/magnifying-glass.svg";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import { ALLERGEN_OPTIONS } from "./RestaurantFilters";

const ALLERGEN_LABELS = Object.fromEntries(
  ALLERGEN_OPTIONS.map(({ label, value }) => [value, label])
);

const PAGE_SIZE = 6;

export default function RestaurantResults({
  query,
  onQueryChange,
  allergens,
  results,
  loading,
  error,
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset how many cards are revealed whenever the underlying result set changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [results]);

  const selectedAllergenLabels = allergens.map((a) => ALLERGEN_LABELS[a] || a);
  const visibleResults = results.slice(0, visibleCount);

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-8 items-start w-full">
      <div className="flex flex-col gap-2 items-start w-full">
        <h1 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight sm:leading-[48px] text-teal-950">
          {loading ? "Searching restaurants…" : `${results.length} Certified Restaurant${results.length === 1 ? "" : "s"}`}
        </h1>
        {selectedAllergenLabels.length > 0 && (
          <p className="text-base text-grey-600">
            Filtered for{" "}
            {selectedAllergenLabels.map((label, i) => (
              <span key={label}>
                <span className="font-semibold text-grey-800">{label.toLowerCase()}-safe</span>
                {i < selectedAllergenLabels.length - 1 &&
                  (i === selectedAllergenLabels.length - 2 ? " and " : ", ")}
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 w-full max-w-[440px] rounded-md border border-grey-400 bg-white px-4 py-2.5">
        <img src={magnifyingGlass} alt="" className="size-5 opacity-60" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="ZIP or restaurant name"
          className="flex-1 min-w-0 text-base text-teal-950 placeholder:text-grey-500 outline-none"
        />
      </div>

      {error && (
        <p className="text-sm font-medium text-red-600">{error}</p>
      )}

      {!loading && !error && results.length === 0 && (
        <p className="text-base text-grey-600">
          No restaurants match your filters yet. Try widening your search.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
        {visibleResults.map((restaurant) => {
          const {
            slug,
            name,
            city,
            state,
            heroPhotoUrl,
            allergenSpecialties,
            certifiedCount,
            totalEmployees,
            distanceMi,
            avgRating,
            reviewCount,
          } = restaurant;

          const location = [city, state].filter(Boolean).join(", ");

          return (
            <div
              key={slug}
              className="flex flex-col items-start rounded-2xl border border-grey-300 bg-white overflow-hidden hover:-translate-y-1 hover:shadow-lg transition-[transform,box-shadow] duration-300"
            >
              <div className="relative aspect-[8/5] w-full bg-teal-600 overflow-hidden">
                {heroPhotoUrl ? (
                  <img src={heroPhotoUrl} alt={name} className="size-full object-cover" />
                ) : (
                  <div className="size-full flex items-center justify-center text-white font-serif font-semibold text-2xl">
                    {name.charAt(0).toUpperCase()}
                  </div>
                )}
                {totalEmployees > 0 && (
                  <div className="absolute top-3 left-3">
                    <Badge tone="white">
                      {certifiedCount}/{totalEmployees} Certified
                    </Badge>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-3 items-start p-6 w-full">
                <div className="flex flex-col gap-1 items-start w-full">
                  <h3 className="font-serif font-semibold text-xl leading-8 text-teal-950 w-full">
                    {name}
                  </h3>
                  <div className="flex flex-wrap gap-2 items-center">
                    {location && <p className="text-base text-grey-600">{location}</p>}
                    {distanceMi != null && (
                      <>
                        {location && <div className="size-[3px] rounded-full bg-grey-500" />}
                        <p className="text-base text-grey-600">{distanceMi} mi</p>
                      </>
                    )}
                    {avgRating != null && (
                      <>
                        {(location || distanceMi != null) && (
                          <div className="size-[3px] rounded-full bg-grey-500" />
                        )}
                        <p className="text-base text-grey-600">
                          ★ {avgRating} ({reviewCount})
                        </p>
                      </>
                    )}
                  </div>
                </div>
                {allergenSpecialties && allergenSpecialties.length > 0 && (
                  <div className="flex flex-wrap gap-2 items-center w-full">
                    {allergenSpecialties.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded px-2.5 py-1 text-xs font-bold uppercase bg-teal-050 text-teal-700"
                      >
                        {ALLERGEN_LABELS[tag] || tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!loading && visibleCount < results.length && (
        <Button
          variant="outline"
          className="mx-auto"
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
        >
          Show {Math.min(PAGE_SIZE, results.length - visibleCount)} more restaurants
        </Button>
      )}
    </div>
  );
}
