import { Link, useParams } from "react-router-dom";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import SectionCard from "../components/ui/SectionCard";
import ReviewerShell from "../components/reviewer/ReviewerShell";
import { SUBMISSIONS } from "./SubmissionQueue";

function ArrowLeftIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.5 4.5 6 11l6.5 6.5" />
    </svg>
  );
}

function CheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 10.5 8 14.5 16 5.5" />
    </svg>
  );
}

function WarningIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 2.5 18 17H2z" />
      <path d="M10 8v4M10 14.5v.01" />
    </svg>
  );
}

function ImageIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <circle cx="7" cy="8" r="1.5" />
      <path d="M4 15l4.5-4.5 2.5 2.5 3-3.5L17.5 14" />
    </svg>
  );
}

const STATUS_CONFIG = {
  pending: { label: "Pending", tone: "white" },
  inReview: { label: "In review", tone: "tealDark" },
  infoRequested: { label: "Info requested", tone: "yellow" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
};

const SUBMISSION_DETAILS = {
  "the-copper-spoon": {
    legalName: "Copper Spoon Hospitality LLC",
    dba: "The Copper Spoon",
    ein: "84-1923456",
    healthPermit: "OR-MC-88213",
    ownerAttestedStaff: "12 staff",
    seats: "64 seats",
    cuisine: "New American",
    allergenAccommodations: "Dedicated fryer, allergen-specific menu, cross-contact protocol",
  },
};

const PHOTOS = ["Kitchen", "Dining room", "Menu board", "Health permit", "Allergen menu", "Storage"];

const AUTOMATED_CHECKS = [
  { label: "Health permit verified", status: "pass" },
  { label: "EIN matches business registry", status: "pass" },
  { label: "Address matches submitted photos", status: "pass" },
  {
    label: "Menu contains allergen disclosures",
    status: "warn",
    note: "Manual review recommended",
  },
];

export default function SubmissionDetail() {
  const { id } = useParams();
  const submission = SUBMISSIONS.find((s) => s.id === id);
  const details = SUBMISSION_DETAILS[id];

  if (!submission) {
    return (
      <ReviewerShell activeNav="submissions">
        <p className="text-base text-grey-600">Submission not found.</p>
        <Link to="/internal/submissions" className="text-sm font-semibold text-teal-700">
          Back to queue
        </Link>
      </ReviewerShell>
    );
  }

  const statusConfig = STATUS_CONFIG[submission.status];

  return (
    <ReviewerShell activeNav="submissions">
      <Link
        to="/internal/submissions"
        className="flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:text-teal-800 w-fit"
      >
        <ArrowLeftIcon className="size-4" />
        Back to queue
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            {submission.restaurant}
          </h1>
          <p className="text-base text-grey-600">
            {submission.city} &middot; Received {submission.received}
          </p>
        </div>
        <Badge tone={statusConfig.tone}>{statusConfig.label}</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="flex flex-col gap-6">
          <SectionCard title="Restaurant info">
            <div className="grid grid-cols-2 gap-5">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Legal name</p>
                <p className="text-base text-teal-950">{details?.legalName ?? "\u2014"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">DBA</p>
                <p className="text-base text-teal-950">{details?.dba ?? "\u2014"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">EIN</p>
                <p className="text-base text-teal-950">{details?.ein ?? "\u2014"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Health permit</p>
                <p className="text-base text-teal-950">{details?.healthPermit ?? "\u2014"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Owner-attested staff</p>
                <p className="text-base text-teal-950">{details?.ownerAttestedStaff ?? "\u2014"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Seats</p>
                <p className="text-base text-teal-950">{details?.seats ?? "\u2014"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Cuisine</p>
                <p className="text-base text-teal-950">{details?.cuisine ?? "\u2014"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-grey-500">Allergen accommodations</p>
                <p className="text-base text-teal-950">
                  {details?.allergenAccommodations ?? "\u2014"}
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Photos submitted">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {PHOTOS.map((label) => (
                <div
                  key={label}
                  className="flex flex-col items-center justify-center gap-2 aspect-square rounded-lg bg-grey-100 text-grey-400"
                >
                  <ImageIcon className="size-6" />
                  <p className="text-xs font-semibold text-grey-500">{label}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="flex flex-col gap-6">
          <SectionCard title="Decision">
            <div className="flex flex-col gap-3">
              <Button variant="primary" size="sm" className="w-full bg-green-700 hover:bg-green-800">
                Approve &amp; issue credential
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full border-yellow-700 text-yellow-700 hover:bg-yellow-100"
              >
                Request more info
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full border-red-600 text-red-700 hover:bg-red-100"
              >
                Reject
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Automated checks">
            <div className="flex flex-col gap-3">
              {AUTOMATED_CHECKS.map((check) => (
                <div key={check.label} className="flex items-start gap-3">
                  {check.status === "pass" ? (
                    <div className="flex items-center justify-center size-5 rounded-full bg-green-100 text-green-700 shrink-0 mt-0.5">
                      <CheckIcon className="size-3" />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center size-5 rounded-full bg-yellow-100 text-yellow-700 shrink-0 mt-0.5">
                      <WarningIcon className="size-3" />
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-semibold text-teal-950">{check.label}</p>
                    {check.note && <p className="text-xs text-grey-500">{check.note}</p>}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </ReviewerShell>
  );
}
