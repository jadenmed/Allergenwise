import { Link } from "react-router-dom";
import blog1 from "../assets/blog-1.jpg";
import blog2 from "../assets/blog-2.jpg";
import blog3 from "../assets/blog-3.jpg";
import Badge from "./ui/Badge";
import Button from "./ui/Button";

const RELATED = [
  { image: blog1, name: "the Garden Table", location: "Portland, OR", distance: "0.4 mi", rating: "4.9" },
  { image: blog2, name: "the Garden Table", location: "Portland, OR", distance: "0.4 mi", rating: "4.9" },
  { image: blog3, name: "the Garden Table", location: "Portland, OR", distance: "0.4 mi", rating: "4.9" },
];

export default function RelatedReading() {
  return (
    <section className="w-full flex flex-col items-center justify-center bg-white px-4 sm:px-6 lg:px-12 py-16 lg:py-24">
      <div className="w-full max-w-[1200px] flex flex-col items-center gap-10">
        <h2 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight sm:leading-[48px] text-teal-950 text-center">
          Related Reading
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
          {RELATED.map(({ image, name, location, distance, rating }, i) => (
            <div
              key={i}
              className="flex flex-col items-start rounded-2xl border border-grey-300 bg-white overflow-hidden hover:-translate-y-1 hover:shadow-lg transition-[transform,box-shadow] duration-300 cursor-pointer"
            >
              <div className="relative aspect-[8/5] w-full bg-teal-600 overflow-hidden">
                <img src={image} alt={name} className="size-full object-cover" />
                <div className="absolute top-3 left-3">
                  <Badge tone="white">Verified</Badge>
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
                  {["Category", "Category", "Category"].map((tag, j) => (
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
        <Link to="/resources">
          <Button variant="outline">View more articles</Button>
        </Link>
      </div>
    </section>
  );
}
