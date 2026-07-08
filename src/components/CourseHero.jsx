import { Link } from "react-router-dom";
import Badge from "./ui/Badge";
import Button from "./ui/Button";

function ClockIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4l2.5 2.5" />
    </svg>
  );
}

function DocumentIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 2.5h7l3 3v12a.5.5 0 0 1-.5.5h-9.5a.5.5 0 0 1-.5-.5v-14a.5.5 0 0 1 .5-.5Z" />
      <path d="M12 2.5V6h3" />
      <path d="M7 10h6M7 13h6M7 16h3" />
    </svg>
  );
}

export default function CourseHero() {
  return (
    <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 pt-10 sm:pt-14 lg:pt-20 pb-12 lg:pb-16 anim-fade-up">
      <div className="w-full max-w-[1200px] flex flex-col gap-8 items-start">
        <div className="flex flex-col gap-6 items-start max-w-[720px]">
          <Badge>Accredited course &middot; ANAB-accredited program</Badge>
          <div className="flex flex-col gap-3 w-full">
            <h1 className="font-serif font-semibold text-3xl sm:text-4xl lg:text-[44px] leading-tight lg:leading-[52px] text-teal-950">
              Restaurant Allergen Safety Certification
            </h1>
            <p className="text-base sm:text-lg leading-7 text-grey-900">
              The complete training your front- and back-of-house team needs
              to safely serve allergic diners — five modules, one exam, one
              verifiable credential per staff member.
            </p>
          </div>
          <div className="flex flex-wrap gap-4 items-center">
            <Link to="/course/lesson/1/1">
              <Button>View the course</Button>
            </Link>
            <Button variant="outline">See the owner dashboard</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 sm:gap-6 items-center">
          <Badge>For restaurant owners &amp; operators</Badge>
          <div className="flex items-center gap-2 text-sm text-grey-800">
            <ClockIcon className="size-5 text-teal-700" />
            <span>~3 hours, self-paced</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-grey-800">
            <DocumentIcon className="size-5 text-teal-700" />
            <span>~3 hours, self-paced</span>
          </div>
        </div>
      </div>
    </section>
  );
}
