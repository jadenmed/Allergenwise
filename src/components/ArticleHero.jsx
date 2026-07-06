import heroImage from "../assets/blog-1.jpg";
import Badge from "./ui/Badge";

export default function ArticleHero() {
  return (
    <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 pt-10 sm:pt-14 lg:pt-16 pb-10 lg:pb-14">
      <div className="w-full max-w-[1200px] flex flex-col gap-6 items-start">
        <Badge>For Diners &amp; Parents</Badge>
        <div className="flex flex-col gap-3 items-start w-full max-w-[760px]">
          <h1 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight text-teal-950 w-full">
            Do Restaurants Need Allergen Training? A 2026 Guide for Owners
          </h1>
          <p className="text-base sm:text-lg leading-7 text-grey-900 w-full">
            Allergen-training mandates vary by jurisdiction — and "best
            practice" no longer protects you from liability. Here's a
            clear-eyed look at what's required in your region, what's coming,
            and how to stay ahead without overcommitting.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 w-full">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded-full bg-teal-700 text-white text-sm font-semibold shrink-0">
              MH
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-teal-950">Dr. Maya Hernandez</p>
              <p className="text-sm text-grey-600">Lead Curriculum · AllergenWise</p>
            </div>
          </div>
          <p className="text-sm text-grey-500">7 min read &middot; May 29, 2026</p>
        </div>
        <div className="w-full flex flex-col gap-2 items-start">
          <div className="w-full aspect-[16/8] rounded-2xl overflow-hidden bg-teal-600">
            <img
              src={heroImage}
              alt="Kitchen staff preparing a dish, the credentialing motif used across AllergenWise"
              className="size-full object-cover"
            />
          </div>
          <p className="text-sm italic text-grey-500">
            The credentialing motif — used across the AllergenWise system to
            anchor verified state.
          </p>
        </div>
      </div>
    </section>
  );
}
