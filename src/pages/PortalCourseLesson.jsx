import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../components/ui/Button";
import PortalShell from "../components/portal/PortalShell";
import { getLesson, completeLesson, ApiError } from "../lib/api";

function renderInline(text, keyPrefix) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}

function LessonBody({ text }) {
  const blocks = text.split(/\n\n+/);
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, i) => {
        const lines = block.split("\n");

        if (lines[0].startsWith("## ")) {
          return (
            <h2
              key={i}
              className="font-serif font-semibold text-2xl text-teal-950 mt-2"
            >
              {renderInline(lines[0].slice(3), i)}
            </h2>
          );
        }

        if (lines.every((l) => l.startsWith("> "))) {
          return (
            <blockquote
              key={i}
              className="border-l-4 border-teal-300 bg-teal-050 px-4 py-3 rounded-r-lg flex flex-col gap-1 text-base text-teal-900"
            >
              {lines.map((l, j) => (
                <p key={j}>{renderInline(l.slice(2), `${i}-${j}`)}</p>
              ))}
            </blockquote>
          );
        }

        if (lines.every((l) => l.startsWith("- ") || l.trim() === "")) {
          return (
            <ul
              key={i}
              className="list-disc pl-5 flex flex-col gap-1 text-base leading-7 text-grey-800"
            >
              {lines
                .filter((l) => l.trim() !== "")
                .map((l, j) => (
                  <li key={j}>{renderInline(l.slice(2), `${i}-${j}`)}</li>
                ))}
            </ul>
          );
        }

        if (lines.every((l) => /^\d+\.\s/.test(l) || l.trim() === "")) {
          return (
            <ol
              key={i}
              className="list-decimal pl-5 flex flex-col gap-1 text-base leading-7 text-grey-800"
            >
              {lines
                .filter((l) => l.trim() !== "")
                .map((l, j) => (
                  <li key={j}>
                    {renderInline(l.replace(/^\d+\.\s/, ""), `${i}-${j}`)}
                  </li>
                ))}
            </ol>
          );
        }

        return (
          <p key={i} className="text-base leading-7 text-grey-800">
            {renderInline(block, i)}
          </p>
        );
      })}
    </div>
  );
}

export default function PortalCourseLesson() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getLesson(lessonId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) {
          if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
            navigate("/portal/course", { replace: true });
            return;
          }
          setError(
            err instanceof ApiError ? err.message : "Failed to load lesson."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId, navigate]);

  const handleMarkComplete = async () => {
    setCompleting(true);
    try {
      await completeLesson(lessonId);
      navigate(
        data.nextLessonId
          ? `/portal/course/lesson/${data.nextLessonId}`
          : "/portal/course"
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to mark lesson complete."
      );
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <PortalShell activeNav="course">
        <p className="text-base text-grey-600">Loading lesson&hellip;</p>
      </PortalShell>
    );
  }

  if (error || !data) {
    return (
      <PortalShell activeNav="course">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error || "Something went wrong."}
        </p>
      </PortalShell>
    );
  }

  const { lesson, module, prevLessonId, nextLessonId, progress } = data;
  const isComplete = progress?.status === "complete";

  return (
    <PortalShell activeNav="course">
      <div className="w-full max-w-[820px] flex flex-col gap-8 mx-auto">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-grey-600">
            Module {module.orderIndex} &middot; {module.title}
          </p>
          <h1 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight text-teal-950">
            {lesson.title}
          </h1>
        </div>

        <LessonBody text={lesson.bodyMd} />

        <div className="flex items-center justify-between gap-4 border-t border-grey-300 pt-6">
          {prevLessonId ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/portal/course/lesson/${prevLessonId}`)}
            >
              &larr; Previous lesson
            </Button>
          ) : (
            <div />
          )}

          {isComplete ? (
            <Button
              size="sm"
              className="bg-teal-900 hover:bg-teal-950"
              onClick={() =>
                navigate(
                  nextLessonId
                    ? `/portal/course/lesson/${nextLessonId}`
                    : "/portal/course"
                )
              }
            >
              {nextLessonId ? "Next lesson" : "Back to course"} &rarr;
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-teal-900 hover:bg-teal-950 disabled:opacity-60"
              disabled={completing}
              onClick={handleMarkComplete}
            >
              {completing
                ? "Saving..."
                : `${nextLessonId ? "Mark complete & continue" : "Mark complete & finish module"} \u2192`}
            </Button>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
