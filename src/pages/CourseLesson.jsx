import { Navigate, useParams } from "react-router-dom";
import CourseTopBar from "../components/course/CourseTopBar";
import CourseSidebar from "../components/course/CourseSidebar";
import LessonContent from "../components/course/LessonContent";
import { COURSE_MODULES } from "../data/courseModules";

export default function CourseLesson() {
  const { moduleId, lessonId } = useParams();
  const moduleIdNum = Number(moduleId);
  const lessonIdNum = Number(lessonId);

  const module = COURSE_MODULES.find((m) => m.id === moduleIdNum);
  const lesson = module?.lessons.find((l) => l.id === lessonIdNum);

  if (!module || !lesson) {
    const first = COURSE_MODULES[0];
    return (
      <Navigate
        to={`/course/lesson/${first.id}/${first.lessons[0].id}`}
        replace
      />
    );
  }

  const flatLessons = COURSE_MODULES.flatMap((m) =>
    m.lessons.map((l) => ({ moduleId: m.id, lessonId: l.id }))
  );
  const currentIndex = flatLessons.findIndex(
    (l) => l.moduleId === moduleIdNum && l.lessonId === lessonIdNum
  );
  const prev = currentIndex > 0 ? flatLessons[currentIndex - 1] : null;
  const next =
    currentIndex < flatLessons.length - 1
      ? flatLessons[currentIndex + 1]
      : null;

  return (
    <div className="w-full flex flex-col h-screen bg-white">
      <CourseTopBar moduleId={module.id} lessonId={lesson.id} />
      <div className="flex-1 flex min-h-0">
        <CourseSidebar activeModuleId={module.id} activeLessonId={lesson.id} />
        <LessonContent
          module={module}
          lesson={lesson}
          prevHref={
            prev ? `/course/lesson/${prev.moduleId}/${prev.lessonId}` : null
          }
          nextHref={
            next ? `/course/lesson/${next.moduleId}/${next.lessonId}` : null
          }
          nextLabel={next ? "Mark complete & continue" : "Finish module"}
        />
      </div>
    </div>
  );
}
