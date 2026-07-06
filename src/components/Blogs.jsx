import blog1 from "../assets/blog-1.jpg";
import blog2 from "../assets/blog-2.jpg";
import blog3 from "../assets/blog-3.jpg";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import { useInView } from "../hooks/useInView";

const POSTS = [
  {
    image: blog1,
    category: "Category",
    badgeTone: "teal",
    title: "Train & Certify Your Staff",
    description:
      "Your team completes accredited allergen-safety training covering the major allergens, cross-contact, sanitation, and emergency response, then passes a certification exam.",
    readTime: "7 min read",
    date: "May 29, 2026",
  },
  {
    image: blog2,
    category: "Category",
    badgeTone: "green",
    title: "Train & Certify Your Staff",
    description:
      "Your team completes accredited allergen-safety training covering the major allergens, cross-contact, sanitation, and emergency response, then passes a certification exam.",
    readTime: "7 min read",
    date: "May 29, 2026",
  },
  {
    image: blog3,
    category: "Category",
    badgeTone: "yellow",
    title: "Train & Certify Your Staff",
    description:
      "Your team completes accredited allergen-safety training covering the major allergens, cross-contact, sanitation, and emergency response, then passes a certification exam.",
    readTime: "7 min read",
    date: "May 29, 2026",
  },
];

const BADGE_TONE_CLASSES = {
  teal: "bg-teal-050 text-teal-700",
  green: "bg-green-100 text-green-700",
  yellow: "bg-yellow-100 text-yellow-700",
};

export default function Blogs() {
  const [headingRef, headingInView] = useInView();
  const [cardsRef, cardsInView] = useInView();

  return (
    <section className="w-full flex flex-col items-center justify-center bg-grey-100 px-4 sm:px-6 lg:px-12 py-16 lg:py-24">
      <div className="w-full max-w-[1200px] flex flex-col items-center gap-10">
        <div
          ref={headingRef}
          className={`flex flex-col items-center gap-4 max-w-[520px] w-full text-center ${headingInView ? "anim-fade-up" : "opacity-0"}`}
        >
          <Badge>From the journal</Badge>
          <div className="flex flex-col gap-2 items-start w-full">
            <h2 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight sm:leading-[48px] text-teal-950 w-full">
              Stay Current on Allergen Safety
            </h2>
            <p className="text-base leading-6 text-grey-900 w-full">
              Field-tested guidance for restaurants and families, written by
              certified professionals, reviewed for legal accuracy.
            </p>
          </div>
        </div>

        <div ref={cardsRef} className="flex flex-col sm:flex-row gap-8 items-stretch w-full">
          {POSTS.map(({ image, category, badgeTone, title, description, readTime, date }, i) => (
            <article
              key={i}
              className={`flex-1 min-w-0 flex flex-col items-start rounded-2xl border border-grey-300 bg-white overflow-hidden hover:-translate-y-1 hover:shadow-lg transition-[transform,box-shadow] duration-300 cursor-pointer ${cardsInView ? "anim-fade-up" : "opacity-0"}`}
              style={{ animationDelay: `${i * 120}ms` }}
            >
              <div className="aspect-[160/90] w-full bg-teal-600 overflow-hidden">
                <img
                  src={image}
                  alt=""
                  className="size-full object-cover"
                />
              </div>
              <div className="flex flex-col gap-6 items-start p-8 w-full">
                <div
                  className={`inline-flex items-center justify-center rounded px-3.5 py-2 text-xs font-bold uppercase ${BADGE_TONE_CLASSES[badgeTone]}`}
                >
                  {category}
                </div>
                <div className="flex flex-col gap-3 items-start w-full">
                  <h3 className="font-serif font-semibold text-2xl leading-8 text-teal-950 w-full">
                    {title}
                  </h3>
                  <p className="text-base leading-6 text-grey-800 w-full line-clamp-3">
                    {description}
                  </p>
                </div>
                <div className="flex gap-3 items-center">
                  <p className="text-base text-grey-500">{readTime}</p>
                  <div className="size-[3px] rounded-full bg-grey-500" />
                  <p className="text-base text-grey-500">{date}</p>
                </div>
              </div>
            </article>
          ))}
        </div>

        <Button variant="outline">Read all articles</Button>
      </div>
    </section>
  );
}
