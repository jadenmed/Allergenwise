import Button from "../components/ui/Button";
import SectionCard from "../components/ui/SectionCard";
import ReviewerShell from "../components/reviewer/ReviewerShell";
import iconPlus from "../assets/icon-plus.svg";

function DownloadIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5" />
      <path d="M3.5 15.5v1a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

function SearchIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M16.5 16.5 13 13" />
    </svg>
  );
}

const PARTNERS = [
  {
    id: "persona",
    initials: "PE",
    name: "Persona",
    email: "person@email.com",
    type: "Identity verification",
    status: "active",
    statusLabel: "Active",
    contract: "MSA \u00b7 renews Aug 2026",
    contact: "ops@persona.com",
  },
  {
    id: "honorlock",
    initials: "HL",
    name: "Honorlock",
    email: "person@email.com",
    type: "Exam proctoring",
    status: "active",
    statusLabel: "Active",
    contract: "MSA \u00b7 renews Aug 2026",
    contact: "partnerships@honorlock.com",
  },
  {
    id: "stripe",
    initials: "ST",
    name: "Stripe",
    email: "person@email.com",
    type: "Payments",
    status: "active",
    statusLabel: "Active",
    contract: "Standard terms",
    contact: "via dashboard",
  },
  {
    id: "sticker-mule",
    initials: "SM",
    name: "Sticker Mule",
    email: "person@email.com",
    type: "Decal printing",
    status: "pending",
    statusLabel: "Pending",
    contract: "Bulk pricing \u00b7 renews annually",
    contact: "enterprise@stickermule.com",
  },
];

const STATUS_STYLES = {
  active: "text-green-700",
  pending: "text-yellow-700",
};

const STATUS_DOTS = {
  active: "bg-green-700",
  pending: "bg-yellow-700",
};

export default function Partners() {
  return (
    <ReviewerShell activeNav="partners">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            Partners
          </h1>
          <p className="text-base text-grey-600">
            Third-party integrations &mdash; identity verification,
            proctoring, printing vendors, referral programs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm">
            <DownloadIcon className="size-4" />
            Export .CSV
          </Button>
          <Button variant="primary" size="sm" icon={iconPlus}>
            Add partner
          </Button>
        </div>
      </div>

      <div className="relative w-full max-w-[560px]">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-grey-400" />
        <input
          type="text"
          placeholder="Search partner..."
          className="w-full rounded-lg border border-grey-300 bg-white pl-11 pr-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
        />
      </div>

      <SectionCard title="Partners">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse">
            <thead>
              <tr className="bg-teal-050">
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Partner
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Type
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Integration status
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Contract
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Primary contact
                </th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {PARTNERS.map((partner) => (
                <tr key={partner.id} className="border-t border-grey-300">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center justify-center size-8 rounded-full bg-teal-100 text-xs font-bold text-teal-700 shrink-0">
                        {partner.initials}
                      </div>
                      <div className="flex flex-col">
                        <p className="text-base text-teal-950 whitespace-nowrap">
                          {partner.name}
                        </p>
                        <p className="text-sm text-grey-500 whitespace-nowrap">
                          {partner.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                    {partner.type}
                  </td>
                  <td className="px-3 py-3">
                    <p
                      className={`flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap ${STATUS_STYLES[partner.status]}`}
                    >
                      <span className={`size-1.5 rounded-full ${STATUS_DOTS[partner.status]}`} />
                      {partner.statusLabel}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                    {partner.contract}
                  </td>
                  <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                    {partner.contact}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      className="text-sm font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </ReviewerShell>
  );
}
