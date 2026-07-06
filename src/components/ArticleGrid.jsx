import { Link } from "react-router-dom";
import blog1 from "../assets/blog-1.jpg";
import blog2 from "../assets/blog-2.jpg";
import blog3 from "../assets/blog-3.jpg";

const BADGE_TONE_CLASSES = {
  teal: "bg-teal-050 text-teal-700",
  green: "bg-green-100 text-green-700",
  grey: "bg-grey-300 text-grey-800",
};

const ARTICLES = [
  { image: blog1, category: "Kitchen practice", tone: "teal" },
  { image: blog2, category: "For diners", tone: "green" },
  { image: blog3, category: "Operations", tone: "grey" },
  { image: blog1, category: "Category", tone: "teal" },
  { image: blog2, category: "Category", tone: "green" },
  { image: blog3, category: "Category", tone: "grey" },
].map((item) => ({
  ...item,
  title: "Train & Certify Your Staff",
  description:
    "Your team completes accredited allergen-safety training covering the ma...",
  readTime: "7 min read",
  date: "May 29, 2026",
}));

export default function ArticleGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
      {ARTICLES.map(
        ({ image, category, tone, title, description, readTime, date }, i) => (
          <Link
            key={i}
            to="/resources/do-restaurants-need-allergen-training"
            className="flex flex-col items-start rounded-2xl border border-grey-300 bg-white overflow-hidden hover:-translate-y-1 hover:shadow-lg transition-[transform,box-shadow] duration-300"
          >
            <div className="aspect-[160/90] w-full bg-teal-600 overflow-hidden">
              <img src={image} alt="" className="size-full object-cover" />
            </div>
            <div className="flex flex-col gap-6 items-start p-8 w-full">
              <span
                className={`inline-flex items-center justify-center rounded px-3.5 py-2 text-xs font-bold uppercase ${BADGE_TONE_CLASSES[tone]}`}
              >
                {category}
              </span>
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
          </Link>
        )
      )}
    </div>
  );
}
