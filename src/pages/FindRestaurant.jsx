import { useEffect, useState } from "react";
import RestaurantFilters from "../components/RestaurantFilters";
import RestaurantResults from "../components/RestaurantResults";
import Cta from "../components/Cta";
import { searchRestaurants, ApiError } from "../lib/api";

const ZIP_RE = /^\d{5}$/;

export default function FindRestaurant() {
  const [query, setQuery] = useState("");
  const [allergens, setAllergens] = useState(["peanut_free", "tree_nut_aware"]);
  const [cuisine, setCuisine] = useState("");
  const [radiusMi, setRadiusMi] = useState(25);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const toggleAllergen = (value) => {
    setAllergens((prev) =>
      prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value]
    );
  };

  useEffect(() => {
    let cancelled = false;
    const trimmed = query.trim();
    const isZip = ZIP_RE.test(trimmed);

    setLoading(true);

    const timeout = setTimeout(async () => {
      try {
        const data = await searchRestaurants({
          q: isZip ? "" : trimmed,
          zip: isZip ? trimmed : undefined,
          allergens,
          cuisine,
          radiusMi,
        });
        if (cancelled) return;
        setResults(data);
        setError("");
      } catch (err) {
        if (cancelled) return;
        setResults([]);
        setError(err instanceof ApiError ? err.message : "Couldn't load restaurants.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, allergens, cuisine, radiusMi]);

  return (
    <>
      <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 py-10 lg:py-14">
        <div className="w-full max-w-[1200px] flex flex-col lg:flex-row gap-8 items-start">
          <RestaurantFilters
            allergens={allergens}
            onToggleAllergen={toggleAllergen}
            cuisine={cuisine}
            onCuisineChange={setCuisine}
            radiusMi={radiusMi}
            onRadiusChange={setRadiusMi}
          />
          <RestaurantResults
            query={query}
            onQueryChange={setQuery}
            allergens={allergens}
            results={results}
            loading={loading}
            error={error}
          />
        </div>
      </section>
      <Cta />
    </>
  );
}
