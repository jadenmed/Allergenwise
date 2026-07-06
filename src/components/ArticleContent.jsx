const TOC = [
  { id: "short-version", label: "The short version" },
  { id: "regulatory-patchwork", label: "A regulatory patchwork" },
  { id: "checklist", label: "A 5-step checklist for owners" },
];

export default function ArticleContent() {
  return (
    <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 pb-16 lg:pb-24">
      <div className="w-full max-w-[1200px] flex flex-col lg:flex-row gap-10 lg:gap-16 items-start">
        <aside className="hidden lg:flex flex-col gap-1 w-[220px] shrink-0 sticky top-24">
          <p className="text-xs font-bold uppercase tracking-wide text-grey-600 mb-3">
            In this article
          </p>
          {TOC.map(({ id, label }, i) => (
            <a
              key={id}
              href={`#${id}`}
              className={`pl-4 py-1.5 text-sm border-l-2 ${
                i === 0
                  ? "border-teal-700 text-teal-700 font-semibold"
                  : "border-grey-300 text-grey-600 hover:text-teal-700 hover:border-teal-400"
              }`}
            >
              {label}
            </a>
          ))}
        </aside>

        <article className="flex-1 min-w-0 flex flex-col gap-6 items-start max-w-[720px]">
          <div id="short-version" className="flex flex-col gap-6 items-start w-full">
            <p className="text-base leading-7 text-grey-800">
              <strong className="text-teal-950">Short version:</strong> there
              is no single U.S. federal rule that requires allergen-specific
              training for restaurant staff. But state, local, and
              customer-driven expectations have moved fast — and in 2026, "we
              didn't know" is a much weaker defense than it was five years ago.
              If you're a multi-unit operator, the question isn't whether to
              train, but which standard to align to.
            </p>

            <div className="w-full rounded-lg border-l-4 border-teal-700 bg-teal-050 p-6 flex flex-col gap-1">
              <p className="text-sm font-bold uppercase tracking-wide text-teal-700">
                Important
              </p>
              <p className="text-base leading-6 text-teal-950">
                This article is general guidance, not legal advice.
                Allergen-training requirements vary by jurisdiction and change
                frequently. Verify the rules that apply to you with your local
                food-safety authority and counsel before relying on anything
                below.
              </p>
            </div>

            <blockquote className="w-full border-l-4 border-teal-700 pl-6 flex flex-col gap-2">
              <p className="text-lg font-semibold italic text-teal-950 leading-7">
                "The right question isn't 'is allergen training required?' —
                it's 'what would a reasonable jury expect a careful operator to
                have done?'"
              </p>
              <p className="text-sm text-grey-600">
                — food-safety attorney, anonymized for AllergenWise interview,
                Feb 2026
              </p>
            </blockquote>
          </div>

          <h2
            id="regulatory-patchwork"
            className="font-serif font-semibold text-2xl leading-8 text-teal-950 pt-4"
          >
            A regulatory patchwork
          </h2>
          <p className="text-base leading-7 text-grey-800">
            The U.S. Food and Drug Administration's Food Code recommends that
            the "person in charge" of a food establishment demonstrate
            knowledge of major food allergens, but the Food Code is a model —
            states adopt it (in full, in part, or not at all). The result is a
            patchwork: some states mandate documented allergen training,
            others reference it indirectly through manager certification, and
            a handful have no specific requirement.
          </p>
          <p className="text-base leading-7 text-grey-800">
            Outside the U.S., the picture is similar. The EU's Food
            Information for Consumers Regulation (1169/2011) requires
            allergen disclosure but stops short of mandating a curriculum. The
            U.K. has moved further with Natasha's Law on
            prepacked-for-direct-sale labeling, and Canada's safe-food
            regulations push toward documented allergen controls without
            prescribing a curriculum.
          </p>

          <h2
            id="checklist"
            className="font-serif font-semibold text-2xl leading-8 text-teal-950 pt-4"
          >
            A 5-step checklist for owners
          </h2>
          <p className="text-base leading-7 text-grey-800">
            Independent of jurisdiction, the operational baseline most counsel
            will recommend looks roughly like this:
          </p>
          <ul className="flex flex-col gap-3 w-full list-disc pl-5">
            <li className="text-base leading-6 text-grey-800">
              <strong className="text-teal-950">
                Document a training standard.
              </strong>{" "}
              Pick a recognized program — ServSafe Allergens, AllergenWise, an
              in-house curriculum reviewed by counsel — and document that every
              staff member completed it.
            </li>
            <li className="text-base leading-6 text-grey-800">
              <strong className="text-teal-950">Retain records.</strong>{" "}
              Certificates, completion dates, and renewal dates. Aim for a
              single source of truth your manager can pull in under a minute.
            </li>
            <li className="text-base leading-6 text-grey-800">
              <strong className="text-teal-950">
                Build allergen handling into shift workflow.
              </strong>{" "}
              A trained staff member is not the same as a trained system.
              Ticket flags, dedicated prep zones, and a standard guest
              conversation matter more than any certificate.
            </li>
            <li className="text-base leading-6 text-grey-800">
              <strong className="text-teal-950">Renew on a cadence.</strong>{" "}
              Most credentials lapse after 12 months. Build the reminder into
              your scheduling tool — don't rely on memory.
            </li>
            <li className="text-base leading-6 text-grey-800">
              <strong className="text-teal-950">
                Make verification public.
              </strong>{" "}
              A diner who can scan a seal and see a current credential is
              harder to surprise with an incident, and harder to convince that
              you cut corners.
            </li>
          </ul>
        </article>
      </div>
    </section>
  );
}
