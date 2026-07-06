import blog1 from "../assets/blog-1.jpg";
import blog2 from "../assets/blog-2.jpg";
import blog3 from "../assets/blog-3.jpg";
import magnifyingGlass from "../assets/magnifying-glass.svg";
import Badge from "./ui/Badge";
import Button from "./ui/Button";

const RESULTS = [
  {
    image: blog1,
    status: "verified",
    name: "the Garden Table",
    location: "Portland, OR",
    distance: "0.4 mi",
    rating: "4.9",
    tags: ["Peanut-safe", "Gluten-free", "Dairy-aware"],
  },
  {
    image: blog2,
    status: "expired",
    name: "the Garden Table",
    location: "Portland, OR",
    distance: "0.4 mi",
    rating: "4.9",
    tags: ["Category", "Category", "Category"],
  },
  {
    image: blog3,
    status: "verified",
    name: "the Garden Table",
    location: "Portland, OR",
    distance: "0.4 mi",
    rating: "4.9",
    tags: ["Category", "Category", "Category"],
  },
  {
    image: blog1,
    status: "verified",
    name: "the Garden Table",
    location: "Portland, OR",
    distance: "0.4 mi",
    rating: "4.9",
    tags: ["Category", "Category", "Category"],
  },
  {
    image: blog2,
    status: "verified",
    name: "the Garden Table",
    location: "Portland, OR",
    distance: "0.4 mi",
    rating: "4.9",
    tags: ["Category", "Category", "Category"],
  },
  {
    image: blog3,
    status: "verified",
    name: "the Garden Table",
    location: "Portland, OR",
    distance: "0.4 mi",
    rating: "4.9",
    tags: ["Category", "Category", "Category"],
  },
];

export default function RestaurantResults() {
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-8 items-start w-full">
      <div className="flex flex-col gap-2 items-start w-full">
        <h1 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight sm:leading-[48px] text-teal-950">
          14 Certified Restaurants near Portland
        </h1>
        <p className="text-base text-grey-600">
          Filtered for <span className="font-semibold text-grey-800">peanut-safe</span> and{" "}
          <span className="font-semibold text-grey-800">tree-nut-safe</span>
        </p>
      </div>

      <div className="flex items-center gap-2 w-full max-w-[440px] rounded-md border border-grey-400 bg-white px-4 py-2.5">
        <img src={magnifyingGlass} alt="" className="size-5 opacity-60" />
        <input
          type="text"
          placeholder="City, ZIP, or restaurant name"
          className="flex-1 min-w-0 text-base text-teal-950 placeholder:text-grey-500 outline-none"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
        {RESULTS.map(({ image, status, name, location, distance, rating, tags }, i) => (
          <div
            key={i}
            className="flex flex-col items-start rounded-2xl border border-grey-300 bg-white overflow-hidden hover:-translate-y-1 hover:shadow-lg transition-[transform,box-shadow] duration-300 cursor-pointer"
          >
            <div className="relative aspect-[8/5] w-full bg-teal-600 overflow-hidden">
              <img src={image} alt={name} className="size-full object-cover" />
              <div className="absolute top-3 left-3">
                <Badge tone={status === "expired" ? "red" : "white"}>
                  {status === "expired" ? "Expired" : "Verified"}
                </Badge>
              </div>
            </div>
            <div className="flex flex-col gap-3 items-start p-6 w-full">
              <div className="flex flex-col gap-1 items-start w-full">
                <h3 className="font-serif font-semibold text-xl leading-8 text-teal-950 w-full">
                  {name}
                </h3>
                <div className="flex gap-2 items-center">
                  <p className="text-base text-grey-600">{location}</p>
                  <div className="size-[3px] rounded-full bg-grey-500" />
                  <p className="text-base text-grey-600">{distance}</p>
                  <div className="size-[3px] rounded-full bg-grey-500" />
                  <p className="text-base text-grey-600">★ {rating}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 items-center w-full">
                {tags.map((tag, j) => (
                  <span
                    key={j}
                    className="inline-flex items-center rounded px-2.5 py-1 text-xs font-bold uppercase bg-teal-050 text-teal-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button variant="outline" className="mx-auto">
        Show 5 more restaurants
      </Button>
    </div>
  );
}
