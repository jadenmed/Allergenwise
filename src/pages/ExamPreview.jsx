import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import CheckItem from "../components/ui/CheckItem";
import checkFatGreen from "../assets/check-fat-green.svg";

const STATS = [
  { value: "9 / 9", label: "Questions" },
  { value: "30min", label: "Time limit" },
  { value: "80%", label: "To pass" },
  { value: "2", label: "Retakes" },
];

const SAMPLE_QUESTION = {
  prompt:
    "A guest informs the server they have a severe peanut allergy. The kitchen has just used the same fryer for breaded shrimp that was previously used for peanut-oil-fried tofu. What is the correct response?",
  options: [
    {
      letter: "A",
      text: "Serve the shrimp — the fryer was used for tofu, not direct peanut contact.",
    },
    {
      letter: "B",
      text: "Inform the guest of the peanut-oil cross-contact and offer an alternative preparation or dish.",
    },
    { letter: "C", text: "Rinse the shrimp before plating to remove residue." },
    { letter: "D", text: "Serve the shrimp — refined peanut oil is not allergenic." },
  ],
  correctLetter: "B",
  explanation:
    "In the real exam, you won't see this. Cross-contact from shared fryer oil includes residue and aerosolized particles — even with highly refined peanut oil, the protein exposure is real for severe peanut allergies. Offer an alternative.",
};

const REAL_EXAM_FEATURES = [
  "25 questions drawn from all 5 modules, randomized order",
  "A mix of scenario, multi-select, and single-answer formats",
  "30-minute timer, with 5-minute warning",
  "Webcam-proctored — your camera stays on for the duration",
  "Answers are not revealed during the exam — only correct/incorrect counts at the end",
];

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

function AnswerOption({ letter, text, isCorrect }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-4 ${
        isCorrect
          ? "border-teal-700 bg-teal-050"
          : "border-grey-300 bg-white"
      }`}
    >
      <div
        className={`flex items-center justify-center size-5 rounded-full border shrink-0 mt-0.5 ${
          isCorrect ? "border-teal-700" : "border-grey-400"
        }`}
      >
        {isCorrect && <div className="size-2.5 rounded-full bg-teal-700" />}
      </div>
      <p className="text-base leading-6 text-grey-800">
        <span className="font-semibold text-teal-950">{letter}</span>{" "}
        {text}
      </p>
    </div>
  );
}

export default function ExamPreview() {
  return (
    <div className="w-full flex flex-col bg-grey-100">
      <header className="w-full flex items-center justify-between gap-4 border-b border-grey-300 bg-white px-4 sm:px-6 py-4">
        <div className="flex items-center gap-4 min-w-0">
          <Logo className="shrink-0" />
          <div className="hidden sm:block h-6 w-px bg-grey-300 shrink-0" />
          <p className="hidden sm:block text-sm text-grey-600 truncate">
            Allergen Safety Certification Exam &middot; Preview
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link to="/course">
            <Button variant="outline" size="sm">
              Back to course
            </Button>
          </Link>
          <Link to="/course/exam">
            <Button size="sm">Start real exam</Button>
          </Link>
        </div>
      </header>

      <div className="w-full flex items-center justify-center gap-3 bg-teal-900 px-4 sm:px-6 py-4">
        <div className="w-full max-w-[1200px] flex flex-wrap items-center gap-3">
          <Badge tone="white">Preview mode</Badge>
          <p className="text-sm text-teal-100 flex-1 min-w-[240px]">
            You're looking at a sample question. Answers aren't recorded, no
            proctoring is active, and your credential is not affected.
          </p>
        </div>
      </div>

      <main className="w-full flex flex-col items-center px-4 sm:px-6 lg:px-12 py-10 lg:py-14">
        <div className="w-full max-w-[1200px] flex flex-col gap-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {STATS.map(({ value, label }) => (
              <div
                key={label}
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-grey-300 bg-white p-6 text-center"
              >
                <p className="font-serif font-semibold text-3xl text-teal-950">
                  {value}
                </p>
                <p className="text-sm text-grey-600">{label}</p>
              </div>
            ))}
          </div>

          <div className="w-full max-w-[820px] mx-auto flex flex-col gap-6">
            <div className="flex items-center justify-between gap-4">
              <p className="text-base font-semibold text-teal-950">
                Sample question 1 of 1
              </p>
              <div className="flex items-center gap-1.5 rounded-md border border-grey-300 bg-white px-3 py-1.5 text-sm text-grey-500">
                <ClockIcon className="size-4" />
                <span>&mdash;:&mdash;</span>
              </div>
            </div>

            <div className="flex flex-col gap-6 rounded-2xl border border-grey-300 bg-white p-6 sm:p-8">
              <div className="flex flex-col gap-3">
                <Badge className="self-start">Sample &middot; Single answer</Badge>
                <p className="text-lg leading-7 text-teal-950">
                  {SAMPLE_QUESTION.prompt}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {SAMPLE_QUESTION.options.map(({ letter, text }) => (
                  <AnswerOption
                    key={letter}
                    letter={letter}
                    text={text}
                    isCorrect={letter === SAMPLE_QUESTION.correctLetter}
                  />
                ))}
              </div>

              <div className="flex items-start gap-3 rounded-xl bg-green-100 p-5">
                <img src={checkFatGreen} alt="" className="size-5 shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <p className="text-base font-semibold text-teal-950">
                    Correct answer: {SAMPLE_QUESTION.correctLetter}
                  </p>
                  <p className="text-sm leading-6 text-green-700">
                    {SAMPLE_QUESTION.explanation}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-grey-300 bg-white p-6 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
                What the real exam looks like
              </p>
              <div className="flex flex-col gap-3">
                {REAL_EXAM_FEATURES.map((feature) => (
                  <CheckItem key={feature}>{feature}</CheckItem>
                ))}
              </div>
            </div>

            <div className="flex justify-center">
              <Link to="/course/exam">
                <Button size="lg">Start the real exam</Button>
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
