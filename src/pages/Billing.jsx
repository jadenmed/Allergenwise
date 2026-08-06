import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import DashboardShell from "../components/dashboard/DashboardShell";

function DownloadIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5" />
      <path d="M3.5 15.5v1a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

const CHARGES = [
  { label: "Team annual \u00b7 11 staff (after pending convert)", amount: "$209.00" },
  { label: "ID verification surcharge \u00b7 9 staff", amount: "$45.00" },
];

const INVOICES = [
  {
    invoice: "INV-2026-0142",
    date: "Mar 6, 2026",
    description: "Team annual \u00b7 9 staff \u00b7 year 1",
    amount: "$171.00",
  },
  {
    invoice: "INV-2026-0089",
    date: "Feb 14, 2026",
    description: "ID verification surcharge \u00b7 9 staff",
    amount: "$45.00",
  },
];

export default function Billing() {
  return (
    <DashboardShell activeNav="billing">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif font-semibold text-3xl text-teal-950">
          Billing
        </h1>
        <p className="text-base text-grey-600">
          Your subscription, charges, and payment method. All billing is at
          the restaurant level &mdash; individual staff are never charged.
        </p>
      </div>

      <div className="rounded-2xl border border-grey-300 bg-gradient-to-br from-teal-050 to-white p-6 sm:p-8 flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Badge tone="tealDark" className="w-fit">
            Current plan
          </Badge>
          <div className="text-right">
            <p className="font-serif font-semibold text-3xl text-teal-950">
              $209
            </p>
            <p className="text-sm text-grey-500">total / year &middot; billed annually</p>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <h2 className="font-serif font-semibold text-2xl text-teal-950">
            Team annual
          </h2>
          <p className="text-base text-grey-600">
            Best per-staff rate for full-service restaurants certifying their
            whole team.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-5 pt-6 border-t border-grey-300">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Staff covered
            </p>
            <p className="flex items-center gap-3 text-base font-semibold text-teal-950">
              <span className="flex items-center gap-1.5 text-green-700">
                <span className="size-1.5 rounded-full bg-green-700" />
                9 Active
              </span>
              <span className="flex items-center gap-1.5 text-yellow-700">
                <span className="size-1.5 rounded-full bg-yellow-700" />
                2 Pending
              </span>
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Rate
            </p>
            <p className="text-base font-semibold text-teal-950">$19 / staff / yr</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Auto-renews
            </p>
            <p className="text-base font-semibold text-teal-950">Feb 14, 2027</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Status
            </p>
            <p className="flex items-center gap-1.5 text-base font-semibold text-green-700">
              <span className="size-1.5 rounded-full bg-green-700" />
              Paid
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4 pb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
            Upcoming charge
          </p>
          <p className="text-sm text-grey-500">Feb 14, 2027</p>
        </div>

        {CHARGES.map((charge) => (
          <div
            key={charge.label}
            className="flex items-center justify-between gap-4 py-3 border-t border-grey-300"
          >
            <p className="text-base text-grey-600">{charge.label}</p>
            <p className="text-base font-semibold text-teal-950">{charge.amount}</p>
          </div>
        ))}

        <div className="flex items-center justify-between gap-4 py-3 border-t border-grey-300">
          <p className="text-base text-grey-600">Subtotal</p>
          <p className="text-base font-semibold text-teal-950">$245.00</p>
        </div>
        <div className="flex items-center justify-between gap-4 py-3 border-t border-grey-300">
          <p className="text-base text-grey-600">Tax (Oregon &middot; 0%)</p>
          <p className="text-base font-semibold text-teal-950">$0.00</p>
        </div>
        <div className="flex items-center justify-between gap-4 py-4 border-t border-grey-300">
          <p className="text-lg font-semibold text-teal-950">Total</p>
          <p className="font-serif font-semibold text-3xl text-teal-950">$254</p>
        </div>

        <Button variant="primary" size="lg" className="w-fit mt-2">
          Proceed payment
        </Button>
      </div>

      <div className="rounded-2xl border border-grey-300 bg-white p-6 sm:p-8 flex flex-col gap-5">
        <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
          Invoice history
        </p>

        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="bg-teal-050">
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Invoice
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Date
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Description
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wide text-grey-500 px-3 py-3">
                  Amount
                </th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {INVOICES.map((inv) => (
                <tr key={inv.invoice} className="border-t border-grey-300">
                  <td className="px-3 py-3 text-base text-teal-950 whitespace-nowrap">
                    {inv.invoice}
                  </td>
                  <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                    {inv.date}
                  </td>
                  <td className="px-3 py-3 text-base text-grey-600 whitespace-nowrap">
                    {inv.description}
                  </td>
                  <td className="px-3 py-3">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-green-700 whitespace-nowrap">
                      <span className="size-1.5 rounded-full bg-green-700" />
                      Paid
                    </p>
                  </td>
                  <td className="px-3 py-3 text-base text-teal-950 whitespace-nowrap">
                    {inv.amount}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap"
                    >
                      <DownloadIcon className="size-4" />
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
