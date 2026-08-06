import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import Button from "../components/ui/Button";

function CheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 10.5 8 14.5 16 6" />
    </svg>
  );
}

function UploadIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5" />
      <path d="M3.5 15.5v1a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

function ShieldIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 2.5 16 5v5c0 4-2.6 6.5-6 7.5-3.4-1-6-3.5-6-7.5V5z" />
      <path d="M7.3 10 9.3 12l3.4-4" />
    </svg>
  );
}

function BadgeIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="10" cy="8" r="5" />
      <path d="M7.3 12.5 6 17l4-2 4 2-1.3-4.5" />
    </svg>
  );
}

function CameraIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 7a1.5 1.5 0 0 1 1.5-1.5h1.2l.8-1.5h6l.8 1.5h1.2A1.5 1.5 0 0 1 16 7v7.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14.5V7z" />
      <circle cx="10" cy="10.5" r="3" />
    </svg>
  );
}

function DocumentIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="14" height="10" rx="1.5" />
      <path d="M6 8h5M6 11h3" />
    </svg>
  );
}

const STEPS = [
  { key: "id", label: "ID Upload" },
  { key: "selfie", label: "Selfie" },
  { key: "review", label: "Review" },
];

const STEP_CONTENT = [
  {
    heading: "Upload Your Government ID",
    description:
      "We need to verify your identity before issuing your credential. Use a driver's license, passport, or state ID. Both sides are required for driver's licenses and state IDs.",
  },
  {
    heading: "Take a Selfie to Match Your ID",
    description:
      "We'll match this against the photo on the ID you just uploaded. The check runs in ~10 seconds.",
  },
  {
    heading: "Almost Done \u2013 Review and Submit",
    description:
      "Confirm the photos below are clear and yours, then submit. Verification typically completes in under 30 seconds.",
  },
];

const CHECKLIST_ITEMS = [
  "Face the camera straight on, no hat or glasses",
  "Make sure your face fills the frame",
  "Well-lit area, no strong backlight",
];

function StepIndicator({ current }) {
  return (
    <div className="flex items-center justify-center gap-3 flex-wrap">
      {STEPS.map((s, i) => {
        const isDone = i < current;
        const isActive = i === current;
        return (
          <div key={s.key} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className={`flex items-center justify-center size-7 rounded-full text-sm font-bold shrink-0 ${
                  isDone
                    ? "bg-green-100 text-green-700"
                    : isActive
                      ? "bg-teal-800 text-white"
                      : "bg-grey-300 text-grey-600"
                }`}
              >
                {isDone ? <CheckIcon className="size-4" /> : i + 1}
              </div>
              <p
                className={`text-sm font-semibold whitespace-nowrap ${
                  isDone || isActive ? "text-teal-950" : "text-grey-400"
                }`}
              >
                {s.label}
              </p>
            </div>
            {i < STEPS.length - 1 && (
              <div className="h-px w-10 bg-grey-300" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TrustBar() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-6 rounded-lg bg-grey-100 px-4 py-3 text-sm font-semibold text-teal-950">
      <p className="flex items-center gap-1.5">
        <ShieldIcon className="size-4 text-teal-700" />
        End-to-end encrypted
      </p>
      <p className="flex items-center gap-1.5">
        <BadgeIcon className="size-4 text-teal-700" />
        Verified by <span className="font-bold">third-party provider</span>
      </p>
    </div>
  );
}

function SelfieChecklist() {
  return (
    <div className="flex flex-col gap-2">
      {CHECKLIST_ITEMS.map((item) => (
        <p
          key={item}
          className="flex items-center gap-2 text-base text-teal-950"
        >
          <CheckIcon className="size-4 text-green-700 shrink-0" />
          {item}
        </p>
      ))}
    </div>
  );
}

export default function VerifyIdentity() {
  const [step, setStep] = useState(0);
  const [backUploaded, setBackUploaded] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="w-full min-h-screen flex flex-col bg-grey-100">
      <header className="w-full flex items-center justify-between gap-4 border-b border-grey-300 bg-white px-4 sm:px-6 py-4">
        <div className="flex items-center gap-4 min-w-0">
          <Link to="/">
            <Logo />
          </Link>
          <div className="hidden sm:block h-6 w-px bg-grey-300 shrink-0" />
          <p className="hidden sm:block text-base text-grey-600 truncate">
            Identity verification &middot; secure flow
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center justify-center size-9 rounded-full bg-teal-100 text-xs font-bold text-teal-700">
            DK
          </div>
          <p className="text-base text-teal-950">Daniel Kim</p>
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center px-4 py-12">
        <div className="w-full max-w-[620px] overflow-hidden rounded-2xl border border-grey-200 bg-white shadow-sm">
          <div className="h-1.5 bg-teal-700" />
          <div className="flex flex-col gap-8 p-6 sm:p-8">
            <StepIndicator current={step} />

            <div className="flex flex-col items-center gap-2 text-center">
              <h1 className="font-serif font-semibold text-3xl text-teal-950">
                {STEP_CONTENT[step].heading}
              </h1>
              <p className="max-w-[440px] text-base text-grey-600">
                {STEP_CONTENT[step].description}
              </p>
            </div>

            {step === 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-green-200 bg-green-100/50 p-6 text-center">
                  <div className="flex items-center justify-center size-12 rounded-lg bg-green-200 text-green-700">
                    <CheckIcon className="size-6" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-base font-semibold text-teal-950">
                      Front of ID
                    </p>
                    <p className="text-sm text-grey-500">
                      oregon-dl-front.jpg
                    </p>
                    <p className="text-sm text-grey-500">1.4 MB</p>
                  </div>
                  <p className="flex items-center gap-1 text-sm font-bold uppercase tracking-wide text-green-700">
                    <CheckIcon className="size-3.5" />
                    Uploaded
                  </p>
                </div>

                {backUploaded ? (
                  <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-green-200 bg-green-100/50 p-6 text-center">
                    <div className="flex items-center justify-center size-12 rounded-lg bg-green-200 text-green-700">
                      <CheckIcon className="size-6" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-base font-semibold text-teal-950">
                        Back of ID
                      </p>
                      <p className="text-sm text-grey-500">
                        oregon-dl-back.jpg
                      </p>
                      <p className="text-sm text-grey-500">1.2 MB</p>
                    </div>
                    <p className="flex items-center gap-1 text-sm font-bold uppercase tracking-wide text-green-700">
                      <CheckIcon className="size-3.5" />
                      Uploaded
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setBackUploaded(true)}
                    className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-grey-300 p-6 text-center cursor-pointer hover:border-teal-400"
                  >
                    <div className="flex items-center justify-center size-12 rounded-lg bg-grey-100 text-teal-700">
                      <UploadIcon className="size-6" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-base font-semibold text-teal-950">
                        Back of ID
                      </p>
                      <p className="text-sm text-grey-500">
                        Drop a photo here or{" "}
                        <span className="font-semibold text-teal-700">
                          tap to upload
                        </span>
                      </p>
                    </div>
                  </button>
                )}
              </div>
            )}

            {step === 0 && (
              <>
                <div className="h-px w-full bg-grey-200" />
                <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-grey-500">
                  {["Driver's license", "Passport", "State ID"].map(
                    (label) => (
                      <p key={label} className="flex items-center gap-1.5">
                        <CheckIcon className="size-4 text-grey-400" />
                        {label}
                      </p>
                    ),
                  )}
                </div>
              </>
            )}

            {step === 1 && (
              <div className="relative mx-auto w-full max-w-[280px] aspect-[4/5] overflow-hidden rounded-2xl bg-grey-300 flex items-center justify-center">
                <CameraIcon className="size-12 text-grey-400" />
                <div className="pointer-events-none absolute inset-6 rounded-full border-2 border-dashed border-white/80" />
              </div>
            )}

            {step === 1 && <SelfieChecklist />}

            {step === 2 && (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                      ID document
                    </p>
                    <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-green-700">
                      <CheckIcon className="size-3.5" />
                      Captured
                    </p>
                  </div>
                  <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-grey-300">
                    <DocumentIcon className="size-10 text-grey-400" />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
                      Selfie
                    </p>
                    <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-green-700">
                      <CheckIcon className="size-3.5" />
                      Captured
                    </p>
                  </div>
                  <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-grey-300">
                    <CameraIcon className="size-10 text-grey-400" />
                  </div>
                </div>
              </div>
            )}

            {step === 2 && <SelfieChecklist />}

            {step === 2 && (
              <label className="flex items-start gap-3 rounded-lg bg-teal-050 p-4 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-teal-700"
                />
                <span className="text-sm text-teal-950">
                  <span className="font-semibold">
                    I confirm the photos are mine and the information is
                    accurate.
                  </span>
                  <br />
                  <span className="text-grey-600">
                    Submitting a false identity is a violation of our terms
                    and may result in credential revocation.
                  </span>
                </span>
              </label>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              {step === 0 && (
                <>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setBackUploaded(false)}
                  >
                    Use a different photo
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    className="bg-teal-900 hover:bg-teal-950"
                    onClick={() => setStep(1)}
                  >
                    Continue to selfie
                  </Button>
                </>
              )}
              {step === 1 && (
                <>
                  <Button variant="outline" size="lg" onClick={() => setStep(0)}>
                    &larr; Re-upload ID
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    className="bg-teal-900 hover:bg-teal-950"
                    onClick={() => setStep(2)}
                  >
                    Take selfie
                  </Button>
                </>
              )}
              {step === 2 && (
                <>
                  <Button variant="outline" size="lg" onClick={() => setStep(1)}>
                    &larr; Re-take selfie
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    className="bg-teal-900 hover:bg-teal-950"
                    onClick={() => navigate("/portal/course")}
                  >
                    Submit for verification
                  </Button>
                </>
              )}
            </div>

            <TrustBar />
          </div>
        </div>

        {step > 0 && (
          <p className="mt-6 max-w-[620px] text-center text-sm text-grey-500">
            Your ID image and selfie are processed by our identity
            verification partner and deleted from their servers within 24
            hours of a successful match. Only the verification status
            (pass/fail) and a salted hash are retained.
          </p>
        )}
      </div>
    </div>
  );
}
