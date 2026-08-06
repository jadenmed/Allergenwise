import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/ui/Button";
import AuthShell from "../components/auth/AuthShell";
import { RESTAURANT, OWNER } from "../components/dashboard/DashboardShell";

function ShieldIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 2.5 16 5v5c0 4-2.6 6.5-6 7.5-3.4-1-6-3.5-6-7.5V5z" />
      <path d="M7.3 10 9.3 12l3.4-4" />
    </svg>
  );
}

function ClockIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.5V10l3 2" />
    </svg>
  );
}

function EyeIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10Z" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}

function EyeOffIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2.5 2.5l15 15" />
      <path d="M8.3 4.8A8.6 8.6 0 0 1 10 4.5c5.5 0 8.5 5.5 8.5 5.5a13.9 13.9 0 0 1-3 3.7M5.3 5.9C3 7.4 1.5 10 1.5 10s3 5.5 8.5 5.5a8.4 8.4 0 0 0 3.1-.6" />
      <path d="M7.8 7.8a2.5 2.5 0 0 0 3.5 3.5" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: ShieldIcon,
    title: "Your credential is yours",
    description: "If you change restaurants, your credential moves with you.",
  },
  {
    icon: ClockIcon,
    title: "Self-paced",
    description:
      "Pause and resume modules anytime. No deadline beyond the renewal date.",
  },
];

export default function InviteAccept() {
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    navigate("/verify-identity");
  };

  return (
    <AuthShell
      headerLabel="Already a member? Sign in"
      headerTo="/sign-in"
      badge="You've been invited"
      heading={`Welcome to ${RESTAURANT.name}.`}
      description={`Your manager ${OWNER.name} added you to the certified staff roster. Set up your account, verify your identity, and complete the course \u2014 most staff finish in about 3 hours.`}
      features={FEATURES}
    >
      <div className="rounded-2xl border border-grey-200 bg-white p-5 shadow-sm">
        <p className="text-lg font-semibold text-teal-950">
          {RESTAURANT.name}
        </p>
        <p className="text-sm text-grey-500">
          Invited by {OWNER.name} &middot; May 28, 2026 &middot; expires in 6
          days
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="font-serif font-semibold text-3xl text-teal-950">
          Accept your invitation
        </h2>
        <p className="text-base text-grey-600">
          Set up your account to start the course. You&rsquo;ll verify your
          identity next &mdash; it takes about 2 minutes.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-teal-950">
            Work email
          </label>
          <input
            type="email"
            placeholder="danielkim@email.com"
            className="w-full rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-teal-950">
            Full name
          </label>
          <input
            type="text"
            placeholder="Daniel Kim"
            className="w-full rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-teal-950">Role</label>
          <input
            type="text"
            placeholder="Head Chef"
            className="w-full rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-teal-950">
            Password*
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Create a password"
              className="w-full rounded-lg border border-grey-300 bg-white px-4 py-3 pr-11 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-grey-500 cursor-pointer"
            >
              {showPassword ? (
                <EyeOffIcon className="size-5" />
              ) : (
                <EyeIcon className="size-5" />
              )}
            </button>
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-lg bg-teal-050 p-4 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-teal-700"
          />
          <span className="text-sm text-teal-950">
            <span className="font-semibold">
              I agree to the AllergenWise Terms of Service and Privacy
              Policy.
            </span>
            <br />
            <span className="text-grey-600">
              I understand identity verification is required before my
              credential is issued.
            </span>
          </span>
        </label>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full bg-teal-900 hover:bg-teal-950"
        >
          Accept &amp; continue to identity check
        </Button>
      </form>
    </AuthShell>
  );
}
