import featuredImage from "../assets/blog-1.jpg";

export default function FeaturedArticle() {
  return (
    <div className="w-full flex flex-col lg:flex-row items-stretch rounded-2xl border border-grey-300 bg-white overflow-hidden">
      <div className="w-full lg:w-1/2 aspect-[16/10] lg:aspect-auto bg-teal-600 overflow-hidden">
        <img src={featuredImage} alt="" className="size-full object-cover" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-6 items-start justify-center p-8 lg:p-10">
        <span className="inline-flex items-center justify-center rounded px-3.5 py-2 text-xs font-bold uppercase tracking-wide bg-yellow-100 text-yellow-700">
          Compliance &middot; Featured
        </span>
        <div className="flex flex-col gap-3 items-start w-full">
          <h2 className="font-serif font-semibold text-2xl sm:text-3xl leading-tight text-teal-950 w-full">
            Do Restaurants Need Allergen Training? A 2026 Guide for Owners
          </h2>
          <p className="text-base leading-6 text-grey-800 w-full">
            Allergen-training mandates vary by jurisdiction — and "best
            practice" no longer protects you from liability. A clear-eyed
            look at what's required in your region, what's coming, and how to
            stay ahead without overcommitting.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <p className="text-base text-grey-500">By Dr. Maya Hernandez</p>
          <div className="size-[3px] rounded-full bg-grey-500" />
          <p className="text-base text-grey-500">7 min read</p>
          <div className="size-[3px] rounded-full bg-grey-500" />
          <p className="text-base text-grey-500">May 29, 2026</p>
        </div>
      </div>
    </div>
  );
}
