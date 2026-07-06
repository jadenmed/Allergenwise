import RestaurantFilters from "../components/RestaurantFilters";
import RestaurantResults from "../components/RestaurantResults";
import Cta from "../components/Cta";

export default function FindRestaurant() {
  return (
    <>
      <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 py-10 lg:py-14">
        <div className="w-full max-w-[1200px] flex flex-col lg:flex-row gap-8 items-start">
          <RestaurantFilters />
          <RestaurantResults />
        </div>
      </section>
      <Cta />
    </>
  );
}
