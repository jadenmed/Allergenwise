import { Link } from "react-router-dom";
import Logo from "../Logo";

export default function CourseTopBar({ moduleId, lessonId }) {
  return (
    <header className="w-full flex items-center justify-between gap-4 border-b border-grey-300 bg-white px-4 sm:px-6 py-4">
      <div className="flex items-center gap-4 min-w-0">
        <Logo className="shrink-0" />
        <div className="hidden sm:block h-6 w-px bg-grey-300 shrink-0" />
        <p className="hidden sm:block text-sm text-grey-600 truncate">
          Allergen Safety Certification &middot; Lesson {moduleId}.{lessonId}
        </p>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <p className="hidden sm:block text-sm text-grey-600">Saved &middot; auto</p>
        <Link
          to="/course"
          className="rounded-md border border-grey-400 px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-grey-100"
        >
          Exit course
        </Link>
      </div>
    </header>
  );
}
