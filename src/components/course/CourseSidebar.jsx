import { Link } from "react-router-dom";
import checkFatGreen from "../../assets/check-fat-green.svg";
import { COURSE_MODULES, COURSE_PROGRESS_PERCENT } from "../../data/courseModules";

function ModuleHeaderIcon({ completed, number }) {
  if (completed) {
    return (
      <div className="flex items-center justify-center size-6 rounded-full bg-green-100 shrink-0">
        <img src={checkFatGreen} alt="" className="size-3" />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center size-6 rounded-full bg-teal-100 text-xs font-bold text-teal-700 shrink-0">
      {number}
    </div>
  );
}

function LessonRow({ moduleId, lesson, isActive }) {
  const label = `${moduleId}.${lesson.id} ${lesson.title}`;

  if (isActive) {
    return (
      <Link
        to={`/course/lesson/${moduleId}/${lesson.id}`}
        className="block rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white"
      >
        {label}
      </Link>
    );
  }

  if (lesson.completed) {
    return (
      <Link
        to={`/course/lesson/${moduleId}/${lesson.id}`}
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-green-700 hover:bg-grey-100"
      >
        <img src={checkFatGreen} alt="" className="size-3 shrink-0" />
        {label}
      </Link>
    );
  }

  return (
    <Link
      to={`/course/lesson/${moduleId}/${lesson.id}`}
      className="block rounded-md px-3 py-2 text-sm text-grey-800 hover:bg-grey-100"
    >
      {label}
    </Link>
  );
}

export default function CourseSidebar({ activeModuleId, activeLessonId }) {
  return (
    <aside className="hidden lg:flex w-[300px] shrink-0 flex-col gap-6 border-r border-grey-300 bg-grey-100 px-4 py-6 overflow-y-auto">
      <div className="flex flex-col gap-3 rounded-xl border border-grey-300 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-base font-semibold text-teal-950">
            Course progress
          </p>
          <p className="text-base font-semibold text-teal-950">
            {COURSE_PROGRESS_PERCENT}%
          </p>
        </div>
        <div className="h-2 w-full rounded-full bg-grey-300 overflow-hidden">
          <div
            className="h-full rounded-full bg-teal-700"
            style={{ width: `${COURSE_PROGRESS_PERCENT}%` }}
          />
        </div>
      </div>

      <nav className="flex flex-col gap-5">
        {COURSE_MODULES.map((module) => (
          <div key={module.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-3 px-3 py-1">
              <ModuleHeaderIcon
                completed={module.lessons.every((l) => l.completed)}
                number={module.id}
              />
              <p className="text-base font-semibold text-teal-950">
                {module.title}
              </p>
            </div>
            <div className="flex flex-col gap-0.5 pl-3">
              {module.lessons.map((lesson) => (
                <LessonRow
                  key={lesson.id}
                  moduleId={module.id}
                  lesson={lesson}
                  isActive={
                    module.id === activeModuleId && lesson.id === activeLessonId
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="rounded-lg bg-yellow-100 px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-yellow-700">
        Final exam unlocks at 100%
      </div>
    </aside>
  );
}
