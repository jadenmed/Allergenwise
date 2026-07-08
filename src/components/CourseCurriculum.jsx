import Badge from "./ui/Badge";
import Button from "./ui/Button";
import CheckItem from "./ui/CheckItem";
import checkFatGreen from "../assets/check-fat-green.svg";

const MODULES = [
  {
    id: 1,
    title: "The major allergens",
    description:
      "The big 9, labeling law, and where each hides on a menu · 6 lessons",
    status: "completed",
  },
  {
    id: 2,
    title: "Cross-contact & the kitchen",
    description:
      "Prep surfaces, fryers, utensils, and safe handling workflows · 7 lessons",
    status: "completed",
  },
  {
    id: 3,
    title: "Front-of-house & the guest conversation",
    description:
      "Taking allergy orders, menu language, and ticket flags · 5 lessons",
    status: "current",
  },
  {
    id: 4,
    title: "Cleaning, storage & suppliers",
    description:
      "Sanitation standards, ingredient sourcing, and recall response · 5 lessons",
    status: "locked",
  },
  {
    id: 5,
    title: "Emergency response",
    description:
      "Recognizing anaphylaxis, epinephrine, and the 911 protocol · 4 lessons",
    status: "locked",
  },
];

const STATUS_LABEL = {
  completed: "Completed",
  current: "In progress",
  locked: "Locked",
};

const STATUS_LABEL_CLASS = {
  completed: "text-green-700",
  current: "text-teal-700",
  locked: "text-grey-500",
};

const PRICING_CHECKS = [
  "All 5 modules + proctored exam",
  "Individual certificate & badge QR",
  "Restaurant window seal + public listing",
  "Team dashboard & renewal reminders",
];

const EXAM_STATS = [
  { value: "25", label: "questions" },
  { value: "80%", label: "to pass" },
  { value: "2", label: "free retakes" },
  { value: "~30", label: "minutes" },
];

function ModuleIcon({ status, id }) {
  if (status === "completed") {
    return (
      <div className="flex items-center justify-center size-9 rounded-md bg-green-100 shrink-0">
        <img src={checkFatGreen} alt="" className="size-4" />
      </div>
    );
  }
  return (
    <div
      className={`flex items-center justify-center size-9 rounded-md text-sm font-bold shrink-0 ${
        status === "current"
          ? "bg-teal-100 text-teal-700"
          : "bg-grey-100 text-grey-500 border border-grey-300"
      }`}
    >
      {id}
    </div>
  );
}

export default function CourseCurriculum() {
  return (
    <section className="w-full flex flex-col items-center bg-white px-4 sm:px-6 lg:px-12 py-16 lg:py-24">
      <div className="w-full max-w-[1200px] flex flex-col gap-10">
        <div className="flex flex-col gap-3 max-w-[640px]">
          <h2 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight text-teal-950">
            What Your Team Will Learn
          </h2>
          <p className="text-base leading-6 text-grey-900">
            Five modules build from the fundamentals to live service and
            emergencies. Progress saves automatically for each staff member.
          </p>
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start w-full">
          <div className="flex flex-col gap-4 items-start w-full">
            <div className="flex flex-col gap-3 items-start w-full rounded-xl border border-grey-300 bg-grey-100 p-5">
              <div className="flex items-center justify-between w-full">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-semibold text-teal-950">
                    Sample progress
                  </p>
                  <p className="text-sm text-grey-600">
                    2 of 5 modules complete
                  </p>
                </div>
                <p className="text-sm font-semibold text-teal-950">88%</p>
              </div>
              <div className="w-full h-2 rounded-full bg-grey-300 overflow-hidden">
                <div
                  className="h-full rounded-full bg-teal-700"
                  style={{ width: "88%" }}
                />
              </div>
            </div>

            {MODULES.map(({ id, title, description, status }) => (
              <div
                key={id}
                className="flex items-center justify-between gap-4 w-full rounded-xl border border-grey-300 bg-white p-5"
              >
                <div className="flex items-center gap-4">
                  <ModuleIcon status={status} id={id} />
                  <div className="flex flex-col gap-0.5">
                    <h3
                      className={`text-base font-semibold ${
                        status === "locked" ? "text-grey-500" : "text-teal-950"
                      }`}
                    >
                      {title}
                    </h3>
                    <p className="text-sm text-grey-600">{description}</p>
                  </div>
                </div>
                <p
                  className={`text-sm font-semibold shrink-0 ${STATUS_LABEL_CLASS[status]}`}
                >
                  {STATUS_LABEL[status]}
                </p>
              </div>
            ))}

            <div className="flex flex-col gap-6 items-start w-full rounded-2xl bg-teal-900 p-8 mt-2">
              <Badge tone="white">Final assessment</Badge>
              <div className="flex flex-col gap-2 items-start w-full">
                <h3 className="font-serif font-semibold text-2xl sm:text-3xl text-white">
                  25-Question Certification Exam
                </h3>
                <p className="text-base leading-6 text-teal-100">
                  Drawn from all five modules. Pass to earn an individual,
                  verifiable certificate that counts toward your restaurant's
                  window seal.
                </p>
              </div>
              <div className="flex flex-wrap gap-8 sm:gap-10 items-start w-full">
                {EXAM_STATS.map(({ value, label }) => (
                  <div key={label} className="flex flex-col gap-1">
                    <p className="font-serif font-semibold text-2xl text-white">
                      {value}
                    </p>
                    <p className="text-sm text-teal-100">{label}</p>
                  </div>
                ))}
              </div>
              <Button variant="outline">Preview exam</Button>
            </div>
          </div>

          <div className="flex flex-col gap-6 items-start w-full">
            <div className="flex flex-col gap-6 items-start w-full rounded-2xl border border-grey-300 bg-white p-8">
              <Badge>Per staff pricing</Badge>
              <div className="flex items-baseline gap-1">
                <span className="font-serif font-semibold text-5xl leading-none text-teal-950">
                  $29
                </span>
                <span className="text-base text-grey-600">/ staff</span>
              </div>
              <p className="text-sm text-grey-600">
                One-time. Includes exam, certificate &amp; 12 months of
                verification.
              </p>
              <div className="flex flex-col gap-3 items-start w-full">
                {PRICING_CHECKS.map((check) => (
                  <CheckItem key={check}>{check}</CheckItem>
                ))}
              </div>
              <Button className="w-full justify-center">
                Enroll your team
              </Button>
            </div>

            <div className="flex flex-col gap-3 items-start w-full rounded-2xl bg-teal-050 p-6">
              <h4 className="text-base font-semibold text-teal-950">
                Certification stays current
              </h4>
              <p className="text-sm leading-6 text-grey-800">
                Certificates are valid 12 months. We remind your team 30 days
                before expiry so your window seal never lapses — the same
                date diners see when they scan.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
