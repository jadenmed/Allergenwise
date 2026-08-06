import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Button from "../components/ui/Button";
import AuthShell from "../components/auth/AuthShell";

function CheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 10.5 8 14.5 16 6" />
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
    icon: CheckIcon,
    title: "$0 to start",
    description: "No cost to certify your first staff members.",
  },
  {
    icon: ClockIcon,
    title: "~5 min setup",
    description: "Add your restaurant and invite your team today.",
  },
];

export default function SignUp() {
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    navigate("/sign-up/check-email");
  };

  return (
    <AuthShell
      headerLabel="Already a member? Sign in"
      headerTo="/sign-in"
      badge="For restaurant owners"
      heading="Certify your team. Earn the window seal."
      description="Create your account to submit your restaurant, certify your staff, and start displaying the AllergenWise seal."
      features={FEATURES}
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-serif font-semibold text-3xl text-teal-950">
          Create your restaurant account
        </h2>
        <p className="text-base text-grey-600">
          Tell us about you and your restaurant to get started.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-5">
          <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
            About you
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-teal-950">
              Full name*
            </label>
            <input
              type="text"
              placeholder="Daniel Kim"
              className="w-full rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-teal-950">
              Email*
            </label>
            <input
              type="email"
              placeholder="you@restaurant.com"
              className="w-full rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
            />
            <p className="text-sm text-grey-500">
              This is the owner email &mdash; used for billing and account
              access.
            </p>
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
        </div>

        <div className="flex flex-col gap-5">
          <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
            About the restaurant
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-teal-950">
              Restaurant name*
            </label>
            <input
              type="text"
              placeholder="The Garden Table"
              className="w-full rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-sm font-semibold text-teal-950">
                City*
              </label>
              <input
                type="text"
                placeholder="Portland"
                className="w-full rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-sm font-semibold text-teal-950">
                State/region*
              </label>
              <input
                type="text"
                placeholder="OR"
                className="w-full rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
              />
            </div>
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-lg bg-teal-050 p-4 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-teal-700"
          />
          <span className="text-sm text-teal-950">
            I agree to the Terms of Service and Privacy Policy. Staff
            certification requires identity verification during the exam.
          </span>
        </label>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full bg-teal-900 hover:bg-teal-950"
        >
          Create account
        </Button>
      </form>

      <p className="text-center text-base text-grey-600">
        Already have an account?{" "}
        <Link to="/sign-in" className="font-semibold text-teal-700 hover:text-teal-800">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
