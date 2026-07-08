import { Link } from "react-router-dom";
import Button from "../ui/Button";

export default function LessonContent({
  module,
  lesson,
  prevHref,
  nextHref,
  nextLabel,
}) {
  const { description, intro, bulletsHeading, bullets, secondHeading, secondBody } =
    lesson.content;

  return (
    <main className="flex-1 flex flex-col items-center bg-white px-4 sm:px-8 lg:px-12 py-8 lg:py-10 overflow-y-auto">
      <div className="w-full max-w-[820px] flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-grey-600">
            <Link to="/course" className="hover:text-teal-700">
              Course
            </Link>{" "}
            / {module.title} / {lesson.title}
          </p>
          <h1 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight text-teal-950">
            {lesson.title}
          </h1>
          <p className="text-base leading-7 text-grey-800">{description}</p>
        </div>

        <div className="w-full aspect-video rounded-2xl bg-teal-700" />

        <div className="flex flex-col gap-6">
          <p className="text-base leading-7 text-grey-800">{intro}</p>

          <div className="flex flex-col gap-3">
            <h2 className="font-serif font-semibold text-2xl text-teal-950">
              {bulletsHeading}
            </h2>
            <ul className="flex flex-col gap-2 list-disc pl-5 text-base leading-7 text-grey-800">
              {bullets.map(({ label, text }) => (
                <li key={label}>
                  <span className="font-semibold text-teal-950">{label}</span>{" "}
                  {text}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="font-serif font-semibold text-2xl text-teal-950">
              {secondHeading}
            </h2>
            <p className="text-base leading-7 text-grey-800">{secondBody}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-grey-300 pt-6">
          {prevHref ? (
            <Link to={prevHref}>
              <Button variant="outline" size="sm">
                &larr; Previous lesson
              </Button>
            </Link>
          ) : (
            <div />
          )}
          {nextHref && (
            <Link to={nextHref}>
              <Button size="sm">{nextLabel} &rarr;</Button>
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
