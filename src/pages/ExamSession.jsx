import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import { EXAM_QUESTIONS } from "../data/examQuestions";

const TOTAL_SECONDS = 30 * 60;

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

function CameraIcon({ className = "" }) {
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
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h7A1.5 1.5 0 0 1 13 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-7Z" />
      <path d="M13 8.5 17 6v8l-4-2.5" />
    </svg>
  );
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function ExamSession() {
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const total = EXAM_QUESTIONS.length;
  const question = EXAM_QUESTIONS[currentIndex];
  const isLast = currentIndex === total - 1;

  function selectAnswer(letter) {
    setAnswers((prev) => ({ ...prev, [currentIndex]: letter }));
  }

  function goNext() {
    if (isLast) {
      navigate("/course/exam/results");
      return;
    }
    setCurrentIndex((i) => Math.min(total - 1, i + 1));
  }

  function goPrev() {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }

  return (
    <div className="w-full min-h-screen flex flex-col bg-grey-100">
      <header className="w-full flex items-center justify-between gap-4 border-b border-grey-300 bg-white px-4 sm:px-6 py-4">
        <div className="flex items-center gap-4 min-w-0">
          <Logo className="shrink-0" />
          <div className="hidden sm:block h-6 w-px bg-grey-300 shrink-0" />
          <p className="hidden sm:block text-sm text-grey-600 truncate">
            Allergen Safety Certification Exam &middot; Proctored session
          </p>
        </div>
        <Link to="/course">
          <Button variant="outline" size="sm">
            Save &amp; exit
          </Button>
        </Link>
      </header>

      <div className="hidden lg:flex flex-col items-center gap-2 fixed top-32 right-8 w-[168px] rounded-2xl border border-grey-300 bg-white p-4 z-10">
        <div className="flex items-center justify-center size-14 rounded-xl bg-teal-700">
          <CameraIcon className="size-6 text-white" />
        </div>
        <div className="flex items-center gap-1.5 text-sm font-semibold text-red-600">
          <span className="size-2 rounded-full bg-red-600" />
          Proctored
        </div>
        <p className="text-sm text-grey-800">Maria R.</p>
        <p className="text-xs text-grey-500">Recording</p>
      </div>

      <main className="w-full flex flex-col items-center px-4 sm:px-6 lg:px-12 py-10">
        <div className="w-full max-w-[820px] mx-auto flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-base font-semibold text-teal-950">
              Question {currentIndex + 1} of {total}
            </p>
            <div className="flex items-center gap-1.5 rounded-md border border-grey-300 bg-white px-3 py-1.5 text-sm text-grey-700">
              <ClockIcon className="size-4" />
              <span>{formatTime(secondsLeft)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-6 rounded-2xl border border-grey-300 bg-white p-6 sm:p-8">
            <div className="flex flex-col gap-3">
              <Badge className="self-start">
                Q{currentIndex + 1} &middot; Single answer
              </Badge>
              <p className="text-lg leading-7 text-teal-950">{question.prompt}</p>
            </div>

            <div className="flex flex-col gap-3">
              {question.options.map(({ letter, text }) => {
                const isSelected = answers[currentIndex] === letter;
                return (
                  <button
                    key={letter}
                    type="button"
                    onClick={() => selectAnswer(letter)}
                    className={`flex items-start gap-3 rounded-xl border p-4 text-left cursor-pointer transition-colors ${
                      isSelected
                        ? "border-teal-700 bg-teal-050"
                        : "border-grey-300 bg-white hover:bg-grey-100"
                    }`}
                  >
                    <div
                      className={`flex items-center justify-center size-5 rounded-full border shrink-0 mt-0.5 ${
                        isSelected ? "border-teal-700" : "border-grey-400"
                      }`}
                    >
                      {isSelected && (
                        <div className="size-2.5 rounded-full bg-teal-700" />
                      )}
                    </div>
                    <p className="text-base leading-6 text-grey-800">
                      <span className="font-semibold text-teal-950">{letter}</span>{" "}
                      {text}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={goPrev}
              disabled={currentIndex === 0}
              className={currentIndex === 0 ? "opacity-50 pointer-events-none" : ""}
            >
              &larr; Previous
            </Button>
            <div className="hidden sm:flex items-center gap-1.5">
              {EXAM_QUESTIONS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrentIndex(i)}
                  aria-label={`Go to question ${i + 1}`}
                  className={`size-2 rounded-full transition-colors ${
                    i === currentIndex
                      ? "bg-teal-700"
                      : answers[i]
                      ? "bg-green-200"
                      : "bg-grey-300"
                  }`}
                />
              ))}
            </div>
            <Button size="sm" onClick={goNext}>
              {isLast ? "Finish exam" : "Next"} &rarr;
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 rounded-2xl border border-grey-300 bg-white p-6">
            {EXAM_QUESTIONS.map((_, i) => {
              const isCurrent = i === currentIndex;
              const isAnswered = Boolean(answers[i]);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrentIndex(i)}
                  className={`flex items-center justify-center size-9 rounded-md border text-sm font-semibold shrink-0 ${
                    isCurrent
                      ? "border-teal-700 bg-teal-050 text-teal-700"
                      : isAnswered
                      ? "border-green-200 bg-green-100 text-green-700"
                      : "border-grey-300 bg-white text-teal-950"
                  }`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
