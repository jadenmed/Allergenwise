import Button from "../ui/Button";

function CloseIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 5l10 10M15 5 5 15" />
    </svg>
  );
}

const inputClass =
  "w-full rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700";

export default function InviteStaffModal({ open, onClose, restaurantName }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:w-[560px] h-full bg-white overflow-y-auto flex flex-col">
        <div className="flex items-start justify-between gap-4 px-8 pt-8 pb-6 border-b border-grey-300">
          <h2 className="font-serif font-semibold text-2xl text-teal-950">
            Invite staff member
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
            They&apos;ll receive an email to set up their account, verify
            their identity, and start the course. You&apos;re billed only
            when they&apos;re fully enrolled.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-teal-950">
              Work email<span className="text-red-600">*</span>
            </label>
            <input
              type="email"
              placeholder="staffemail@email.com..."
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-teal-950">
              Full name<span className="text-red-600">*</span>
            </label>
            <input type="text" placeholder="Daniel Kim..." className={inputClass} />
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-teal-950">
                Role<span className="text-red-600">*</span>
              </label>
              <input type="text" placeholder="Sushi chef..." className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-teal-950">
                Employment<span className="text-red-600">*</span>
              </label>
              <input type="text" placeholder="Full-time..." className={inputClass} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-teal-950">
              Personal message{" "}
              <span className="font-normal text-grey-500">(optional)</span>
            </label>
            <textarea
              rows={4}
              placeholder="staffemail@email.com"
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="flex flex-col gap-1 pb-4 border-b border-grey-300">
            <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
              Manager attestation
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-lg bg-grey-100 p-4 cursor-pointer">
            <input type="checkbox" className="mt-1 size-4 accent-teal-700" />
            <div className="flex flex-col gap-1">
              <p className="text-base font-semibold text-teal-950">
                I attest this person is or will be employed at{" "}
                {restaurantName} and will handle allergen-related work.
              </p>
              <p className="text-sm text-grey-600">
                Required by our standards. False attestation is a contract
                breach and may invalidate the restaurant&apos;s window seal.
              </p>
            </div>
          </label>

          <div className="rounded-lg bg-teal-050 p-4 flex flex-col gap-1">
            <p className="text-base font-semibold text-teal-950">
              Billing impact
            </p>
            <p className="text-sm text-teal-700">
              +$19 / year on next renewal (Team annual rate). Charged only
              after enrollment completes.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-8 py-6 border-t border-grey-300">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm">
            Send invite
          </Button>
        </div>
      </div>
    </div>
  );
}
