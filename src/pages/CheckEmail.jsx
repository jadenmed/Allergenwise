import { Link } from "react-router-dom";
import Badge from "../components/ui/Badge";
import { AuthHeader } from "../components/auth/AuthShell";

function MailIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5 12 13l8.5-6.5" />
    </svg>
  );
}

export default function CheckEmail() {
  const email = "maria.reyes@gardentable.co";

  return (
    <div className="w-full min-h-screen flex flex-col bg-white">
      <AuthHeader label="Already a member? Sign in" to="/sign-in" />

      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-[480px] flex flex-col items-center gap-6 text-center">
          <div className="flex items-center justify-center size-16 rounded-full bg-teal-100 text-teal-700">
            <MailIcon className="size-8" />
          </div>

          <Badge tone="teal">Email sent</Badge>

          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            Check Your Email
          </h1>

          <p className="text-base text-grey-600 leading-relaxed">
            We sent a verification link to{" "}
            <span className="font-semibold text-teal-700">{email}</span>. It
            expires in 30 minutes. Open the link to finish setting up your
            account.
          </p>

          <div className="w-full h-px bg-grey-300" />

          <p className="text-base text-grey-600">
            Didn&rsquo;t get the email? Check spam, or resend the link.
          </p>
          <p className="text-base text-grey-600">
            Wrong address?{" "}
            <Link to="/sign-up" className="font-semibold text-teal-700 hover:text-teal-800">
              Go back and fix it.
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
