import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import SectionCard from "../components/ui/SectionCard";
import DashboardShell, { RESTAURANT } from "../components/dashboard/DashboardShell";

function UploadIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 13V3m0 0 3.5 3.5M10 3 6.5 6.5" />
      <path d="M3.5 15.5v1a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

const BANNER_TONES = {
  yellow: { bg: "bg-yellow-100", heading: "text-yellow-700", body: "text-yellow-700" },
  teal: { bg: "bg-teal-050", heading: "text-teal-950", body: "text-teal-700" },
  red: { bg: "bg-red-100", heading: "text-red-700", body: "text-red-700" },
};

const NOTE_TONES = {
  green: { bg: "bg-green-100", heading: "text-teal-950", body: "text-green-700" },
  red: { bg: "bg-red-100", heading: "text-red-700", body: "text-red-700" },
};

const STATUS_CONFIG = {
  waitingForReview: {
    title: "Your submission is in the queue",
    subtitle: "Submitted Mar 12 \u00b7 Reference #SUB-2026-0142",
    banner: {
      tone: "yellow",
      heading: "Awaiting reviewer assignment",
      body: "Typical wait: under 48 hours. You'll receive an email as soon as a reviewer picks it up. Nothing you need to do right now.",
    },
    whatsNext:
      "A member of our review team confirms your business registration, checks your health permit, and reviews the photos. Most submissions get a decision within 3 business days.",
  },
  inReview: {
    title: "Your submission is being reviewed",
    subtitle: "Reference #SUB-2026-0142 \u00b7 Reviewer assigned 2h ago",
    banner: {
      tone: "teal",
      heading: "Being reviewed by our team",
      body: "Reviewer is looking at your info, health permit, and photos. If clarification is needed we'll email you. Expected decision within 24 hours.",
    },
  },
  infoRequested: {
    title: "We need a bit more from you",
    subtitle: "Reference #SUB-2026-0142 \u00b7 Reviewer requested clarification 1h ago",
    banner: {
      tone: "yellow",
      heading: "Reviewer needs 1 clarification before we can approve",
      body: "Address the items below and we'll pick up review immediately. Doesn't affect your place in the queue.",
    },
    note: {
      tone: "green",
      heading: "Photos",
      body: "Could you add a photo of the kitchen showing your allergen prep station? Current photos are all exterior and dining room.",
    },
    photos: true,
    footer: {
      secondary: { label: "Save & exit", to: "/dashboard" },
      primary: { label: "Submit additional info" },
    },
  },
  declined: {
    title: "Your submission was declined",
    subtitle: "Reference #SUB-2026-0142 \u00b7 Reviewed by Viv on Mar 15",
    banner: {
      tone: "red",
      heading: "We can't issue a credential right now",
      body: "See the reviewer's reasoning below. You can appeal or reapply after addressing the issues.",
    },
    note: {
      tone: "red",
      heading: "Health permit could not be verified",
      body: "The permit number provided does not appear in Portland's public registry. We reached out twice for clarification and did not receive a valid response within 7 days.",
    },
    footer: {
      secondary: { label: "Appeal decision" },
      primary: { label: "Fix and resubmit" },
    },
  },
};

export default function SubmissionStatus() {
  const config = STATUS_CONFIG[RESTAURANT.status] ?? STATUS_CONFIG.waitingForReview;
  const banner = BANNER_TONES[config.banner.tone];

  return (
    <DashboardShell activeNav="overview">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif font-semibold text-3xl text-teal-950">
          {config.title}
        </h1>
        <p className="text-base text-grey-500">{config.subtitle}</p>
      </div>

      <div className={`rounded-2xl p-6 sm:p-8 flex flex-col gap-2 ${banner.bg}`}>
        <p className={`text-lg font-semibold ${banner.heading}`}>
          {config.banner.heading}
        </p>
        <p className={`text-base ${banner.body}`}>{config.banner.body}</p>
      </div>

      {config.whatsNext && (
        <div className="rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-2">
          <p className="text-base font-semibold text-teal-950">
            What happens next
          </p>
          <p className="text-base text-grey-600">{config.whatsNext}</p>
        </div>
      )}

      {config.note && (
        <SectionCard title="Reviewer notes">
          <div
            className={`rounded-lg p-4 sm:p-5 flex flex-col gap-1 ${NOTE_TONES[config.note.tone].bg}`}
          >
            <p
              className={`text-base font-semibold ${NOTE_TONES[config.note.tone].heading}`}
            >
              {config.note.heading}
            </p>
            <p className={`text-base ${NOTE_TONES[config.note.tone].body}`}>
              {config.note.body}
            </p>
          </div>
        </SectionCard>
      )}

      {config.photos && (
        <SectionCard title="Photos of your restaurant">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="aspect-square rounded-xl bg-gradient-to-br from-teal-900 to-grey-800 overflow-hidden" />
            {[1, 2, 3].map((slot) => (
              <label
                key={slot}
                className="aspect-square flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-grey-300 px-3 text-center cursor-pointer hover:border-teal-700"
              >
                <input type="file" accept="image/*" className="hidden" />
                <UploadIcon className="size-5 text-grey-500" />
                <p className="text-sm text-grey-500">
                  Drop a photo here or{" "}
                  <span className="font-semibold text-teal-700">tap to upload</span>
                </p>
              </label>
            ))}
          </div>
        </SectionCard>
      )}

      {config.footer && (
        <div className="flex items-center justify-between gap-4">
          {config.footer.secondary.to ? (
            <Link to={config.footer.secondary.to}>
              <Button variant="outline" size="sm">
                {config.footer.secondary.label}
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm">
              {config.footer.secondary.label}
            </Button>
          )}
          <Button variant="primary" size="sm">
            {config.footer.primary.label}
          </Button>
        </div>
      )}
    </DashboardShell>
  );
}
