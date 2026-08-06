import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import DashboardShell, { RESTAURANT } from "../components/dashboard/DashboardShell";

function DownloadIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5" />
      <path d="M3.5 15.5v1a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

function CheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 10.5 8 14.5 16 6" />
    </svg>
  );
}

const STANDARDS = [
  { label: "FDA Food Code \u00a72-403", value: "Aligned", aligned: true },
  { label: "HACCP principles (allergen control)", value: "Aligned", aligned: true },
  { label: "FARE training recommendations", value: "Aligned", aligned: true },
  { label: "Curriculum version", value: "v3.1 \u00b7 reviewed Jan 2026" },
  { label: "Independent review", value: "Annual \u00b7 panel notes available" },
];

const DOCUMENTS = [
  "Per-staff certificate chain (9 PDFs)",
  "Owner attestation (signed)",
  "Identity verification ledger",
  "Full audit log (CSV \u00b7 30d)",
];

export default function CertificationRecord() {
  return (
    <DashboardShell activeNav="overview">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1 max-w-[560px]">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            Certification Record
          </h1>
          <p className="text-base text-grey-600">
            The full registry record for {RESTAURANT.name}. This is what
            diners, inspectors, and counsel see when they look you up.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm">
            <DownloadIcon className="size-4" />
            Download record
          </Button>
          <Link to={`/verify/${RESTAURANT.credentialId}`}>
            <Button variant="primary" size="sm" className="bg-teal-900 hover:bg-teal-950">
              View public page
            </Button>
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-6">
        <Badge tone="tealDark" className="w-fit">
          Active &amp; current
        </Badge>

        <div className="flex flex-col gap-1">
          <h2 className="font-serif font-semibold text-2xl text-teal-950">
            {RESTAURANT.name}
          </h2>
          <p className="text-base text-grey-600">
            412 Mill St &middot; Portland, OR 97232 &middot; USA
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 pt-6 border-t border-grey-300">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Credential ID
            </p>
            <p className="text-base font-semibold text-teal-950">
              {RESTAURANT.credentialId}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Issued
            </p>
            <p className="text-base font-semibold text-teal-950">
              {RESTAURANT.issued}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Valid through
            </p>
            <p className="text-base font-semibold text-teal-950">
              {RESTAURANT.validThrough}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Standard
            </p>
            <p className="text-base font-semibold text-teal-950">
              AllergenWise v3.1 &middot; FDA Food Code aligned
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Aggregate
            </p>
            <p className="text-base font-semibold text-teal-950">
              {RESTAURANT.staffCertifiedCount} of {RESTAURANT.staffTotalCount} staff
              credentials current
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Public listing
            </p>
            <p className="text-base font-semibold text-teal-950">
              allergenwise.com/v/{RESTAURANT.credentialId}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
        <div className="rounded-2xl border border-grey-300 bg-white p-6 flex flex-col">
          <div className="flex items-center justify-between gap-4 pb-4">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Certification status
            </p>
            <Badge tone="tealDark">Active</Badge>
          </div>
          {STANDARDS.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between gap-4 py-3 border-t border-grey-300"
            >
              <p className="text-base text-grey-600">{item.label}</p>
              {item.aligned ? (
                <p className="flex items-center gap-1.5 text-base font-semibold text-green-700">
                  <CheckIcon className="size-4" />
                  {item.value}
                </p>
              ) : (
                <p className="text-base font-semibold text-teal-950">
                  {item.value}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-grey-300 bg-white p-6 flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-wide text-grey-500 pb-1">
            Documents
          </p>
          {DOCUMENTS.map((doc) => (
            <button
              key={doc}
              type="button"
              className="flex items-center gap-3 rounded-lg border border-grey-300 px-4 py-3 text-left text-base font-semibold text-teal-950 hover:bg-grey-100 cursor-pointer"
            >
              <DownloadIcon className="size-4 text-grey-500 shrink-0" />
              {doc}
            </button>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
