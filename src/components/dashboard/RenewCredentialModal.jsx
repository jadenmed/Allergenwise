import Button from "../ui/Button";

function CloseIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 5l10 10M15 5 5 15" />
    </svg>
  );
}

export default function RenewCredentialModal({ open, onClose, person }) {
  if (!open || !person) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:w-[560px] h-full bg-white overflow-y-auto flex flex-col">
        <div className="flex items-start justify-between gap-4 px-8 pt-8 pb-6 border-b border-grey-300">
          <h2 className="font-serif font-semibold text-2xl text-teal-950">
            Renew credential
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-grey-500 hover:text-teal-950 cursor-pointer"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>

        <div className="flex flex-col gap-6 px-8 py-6 flex-1">
          <p className="text-base text-grey-600">
            We&apos;ll start a new certification course for {person.name}.
            Their current credential stays active until it expires, so
            there&apos;s no gap in coverage.
          </p>

          <div className="rounded-lg border border-grey-300 p-4 flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-grey-500">
              Current credential
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-grey-500">Credential ID</p>
                <p className="text-base text-teal-950">{person.credential ?? "\u2014"}</p>
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-grey-500">Status</p>
                <p className="text-base text-yellow-700 font-semibold">{person.statusLabel}</p>
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-grey-500">Issued</p>
                <p className="text-base text-teal-950">{person.issued ?? "\u2014"}</p>
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-grey-500">Expires</p>
                <p className="text-base text-teal-950">{person.expires ?? "\u2014"}</p>
              </div>
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-lg bg-grey-100 p-4 cursor-pointer">
            <input type="checkbox" defaultChecked className="mt-1 size-4 accent-teal-700" />
            <div className="flex flex-col gap-1">
              <p className="text-base font-semibold text-teal-950">
                Notify {person.name.split(" ")[0]}
              </p>
              <p className="text-sm text-grey-600">
                They&apos;ll receive an email to start the renewal course
                before their current credential expires.
              </p>
            </div>
          </label>

          <div className="rounded-lg bg-teal-050 p-4 flex flex-col gap-1">
            <p className="text-base font-semibold text-teal-950">
              Billing impact
            </p>
            <p className="text-sm text-teal-700">
              +$19 / year on next renewal (Team annual rate). Charged only
              after the renewal course completes.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-8 py-6 border-t border-grey-300">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm">
            Send renewal invite
          </Button>
        </div>
      </div>
    </div>
  );
}
