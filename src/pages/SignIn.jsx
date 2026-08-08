import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/ui/Button";
import AuthShell from "../components/auth/AuthShell";
import { login, homeRouteForRole, ApiError } from "../lib/api";

function LockIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      <path d="M6.5 9V6a3.5 3.5 0 0 1 7 0v3" />
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

function GoogleIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" className={className}>
      <path
        fill="#4285F4"
        d="M19.6 10.2c0-.7-.06-1.36-.18-2H10v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.75 3-4.3 3-7.3Z"
      />
      <path
        fill="#34A853"
        d="M10 20c2.7 0 4.96-.9 6.6-2.44l-3.2-2.5c-.9.6-2 .95-3.4.95-2.6 0-4.8-1.76-5.6-4.12H1.1v2.6A10 10 0 0 0 10 20Z"
      />
      <path
        fill="#FBBC05"
        d="M4.4 11.9a6 6 0 0 1 0-3.8V5.5H1.1a10 10 0 0 0 0 9l3.3-2.6Z"
      />
      <path
        fill="#EA4335"
        d="M10 3.98c1.47 0 2.8.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 10 0 10 10 0 0 0 1.1 5.5l3.3 2.6C5.2 5.74 7.4 3.98 10 3.98Z"
      />
    </svg>
  );
}

const FEATURES = [
  {
    icon: LockIcon,
    title: "Encrypted sessions",
    description: "Auth tokens rotate every 30 minutes.",
  },
  {
    icon: ShieldIcon,
    title: "2FA available",
    description: "Recommended for owners. SMS or authenticator app.",
  },
];

export default function SignIn() {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { role } = await login(email, password);
      navigate(homeRouteForRole(role));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      headerLabel="Create account"
      headerTo="/sign-up"
      badge="Welcome back"
      heading="Verify with confidence. Manage with one login."
      description="Sign in to review submissions, manage staff certifications, and keep your allergen program up to date."
      features={FEATURES}
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-serif font-semibold text-3xl text-teal-950">
          Sign in
        </h2>
        <p className="text-base text-grey-600">
          Welcome back. Enter your details to continue.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-teal-950">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@restaurant.com"
            className="w-full rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-teal-950">
              Password*
            </label>
            <Link to="#" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter your password"
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

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={loading}
          className="w-full bg-teal-900 hover:bg-teal-950 disabled:opacity-60"
        >
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-grey-300" />
        <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
          Or
        </p>
        <div className="h-px flex-1 bg-grey-300" />
      </div>

      <Button variant="outline" size="lg" className="w-full">
        <GoogleIcon className="size-5" />
        Continue with Google
      </Button>

      <p className="text-center text-base text-grey-600">
        Don&rsquo;t have an account?{" "}
        <Link to="/sign-up" className="font-semibold text-teal-700 hover:text-teal-800">
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}
