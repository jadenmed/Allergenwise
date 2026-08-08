import { useNavigate } from "react-router-dom";
import heroPhones from "../assets/hero-phones.png";
import magnifyingGlass from "../assets/magnifying-glass.svg";
import Badge from "./ui/Badge";
import Button from "./ui/Button";

const FILTERS = [
  "Near me",
  "Peanut safe",
  "Tree-nut-safe",
  "Gluten-free",
  "Dairy-free",
  "Shellfish-free",
];

export default function DinerHero() {
  const navigate = useNavigate();

  return (
    <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 pt-10 sm:pt-14 lg:pt-20 pb-12 lg:pb-20">
      <div className="w-full max-w-[1200px] flex flex-col lg:flex-row lg:items-center gap-10 lg:gap-12">
        <div
          className="flex flex-col gap-8 items-start w-full lg:max-w-[652px] anim-fade-left"
          style={{ animationDelay: "100ms" }}
        >
          <Badge>For Diners &amp; Parents</Badge>
          <div className="flex flex-col gap-2 w-full">
            <h1 className="font-serif font-semibold text-3xl sm:text-4xl lg:text-[48px] leading-tight lg:leading-[52px] text-teal-950">
              Eat Out with Confidence, Verify Before You Sit Down
            </h1>
            <p className="text-base sm:text-lg leading-7 text-grey-900">
              Search certified restaurants near you, filter by allergen, and
              scan a window seal to confirm the certification is real and
              current — in under two seconds, with no app or account.
            </p>
          </div>
          <div className="flex flex-col gap-3 items-start w-full">
            <div className="flex gap-3 items-center w-full max-w-[440px]">
              <div className="flex flex-1 items-center gap-2 rounded-md border border-grey-400 bg-white px-4 py-2.5">
                <img src={magnifyingGlass} alt="" className="size-5 opacity-60" />
                <input
                  type="text"
                  placeholder="City, ZIP, or restaurant name"
                  className="flex-1 min-w-0 text-base text-teal-950 placeholder:text-grey-500 outline-none"
                />
              </div>
              <Button size="sm" onClick={() => navigate("/find-restaurant")}>
                Search
              </Button>
            </div>
            <div className="flex flex-wrap gap-3 items-center w-full">
              {FILTERS.map((filter, i) => (
                <button
                  key={filter}
                  type="button"
                  className={`px-4 py-2.5 rounded-md text-base font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    i === 0
                      ? "bg-teal-800 text-white hover:bg-teal-900"
                      : "bg-white text-teal-700 border border-grey-400 hover:bg-grey-100"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className="w-full max-w-[420px] mx-auto lg:mx-0 lg:max-w-none lg:flex-1 aspect-square lg:aspect-auto lg:h-[590px] relative anim-fade-right"
          style={{ animationDelay: "250ms" }}
        >
          <img
            src={heroPhones}
            alt="AllergenWise app showing a verified restaurant certification"
            className="absolute inset-0 size-full object-cover pointer-events-none"
          />
        </div>
      </div>
    </section>
  );
}
