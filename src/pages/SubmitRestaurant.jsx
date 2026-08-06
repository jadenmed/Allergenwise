import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import SectionCard from "../components/ui/SectionCard";
import DashboardShell from "../components/dashboard/DashboardShell";

const CUISINES = ["American", "Italian", "Mexican", "Asian Fusion", "Mediterranean", "Other"];
const PRICE_RANGES = ["$", "$$", "$$$", "$$$$"];

const ALLERGENS = [
  "Peanut-safe menu",
  "Tree-nut-safe",
  "Gluten-free options",
  "Dairy-free options",
  "Egg-free options",
  "Shellfish-free",
  "Soy-free options",
  "Wheat-free options",
];

const inputClass =
  "w-full rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700";

function UploadIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 13V3m0 0 3.5 3.5M10 3 6.5 6.5" />
      <path d="M3.5 15.5v1a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

function BackArrowIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.5 4 6 10l6.5 6" />
    </svg>
  );
}

function Field({ label, required, hint, className = "", children }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="text-sm font-semibold text-teal-950">
        {label}
        {required && <span className="text-red-600"> *</span>}
        {hint && <span className="font-normal text-grey-500"> {hint}</span>}
      </label>
      {children}
    </div>
  );
}

export default function SubmitRestaurant() {
  return (
    <DashboardShell activeNav="overview">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif font-semibold text-3xl text-teal-950">
          Submit your restaurant for the AllergenWise directory
        </h1>
        <p className="max-w-[720px] text-base text-grey-600">
          Get listed in our public directory of allergen-safe restaurants.
          Once submitted, our review team will confirm your details and issue
          your credential within 3 business days.
        </p>
      </div>

      <SectionCard title="1. Restaurant basics">
        <Field label="Legal restaurant name" required>
          <input type="text" placeholder="e.g. The Garden Table LLC" className={inputClass} />
        </Field>
        <Field label="DBA / display name" required>
          <input type="text" placeholder="How diners will see you..." className={inputClass} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Cuisine" required>
            <select defaultValue="" className={`${inputClass} text-grey-400`}>
              <option value="" disabled>
                Select cuisine...
              </option>
              {CUISINES.map((cuisine) => (
                <option key={cuisine} value={cuisine} className="text-teal-950">
                  {cuisine}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Price range" required>
            <select defaultValue="$" className={inputClass}>
              {PRICE_RANGES.map((range) => (
                <option key={range} value={range}>
                  {range}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Attested staff" required>
            <input type="number" placeholder="11" className={inputClass} />
          </Field>
          <Field label="Seats">
            <input type="number" placeholder="64" className={inputClass} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="2. Location & contact">
        <Field label="Street address" required>
          <input type="text" placeholder="412 Mill St..." className={inputClass} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <Field label="City" required>
            <input type="text" placeholder="City..." className={inputClass} />
          </Field>
          <Field label="State / region">
            <input type="text" placeholder="State / region..." className={inputClass} />
          </Field>
          <Field label="ZIP / postal">
            <input type="text" placeholder="ZIP / postal..." className={inputClass} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Phone">
            <input type="tel" placeholder="+1 (503) 555-0184" className={inputClass} />
          </Field>
          <Field label="Website">
            <input type="text" placeholder="gardentable.co..." className={inputClass} />
          </Field>
        </div>
        <Field label="Google Maps link" hint="(optional)">
          <input type="text" placeholder="https://share.google/......" className={inputClass} />
        </Field>
      </SectionCard>

      <SectionCard
        title="3. Allergen accommodations offered"
        description="Check the allergens your kitchen can accommodate. We'll verify these during review."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ALLERGENS.map((allergen) => (
            <label
              key={allergen}
              className="flex items-center gap-3 rounded-lg border border-grey-300 px-4 py-3 text-base text-teal-950 cursor-pointer hover:bg-grey-100"
            >
              <input type="checkbox" className="size-4 accent-teal-700" />
              {allergen}
            </label>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="4. Photos of your restaurant"
        description="Upload 4-8 photos: exterior (for the window seal spot), dining room, kitchen (allergen prep area), and any signage. No stock imagery."
      >
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

      <SectionCard title="5. Owner attestation">
        <label className="flex items-start gap-3 rounded-lg bg-grey-100 p-4 cursor-pointer">
          <input type="checkbox" className="mt-1 size-4 accent-teal-700" />
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-teal-950">
              I confirm the information above is accurate and I am authorized
              to represent this restaurant.
            </p>
            <p className="text-sm text-grey-600">
              False attestation may result in credential rejection or
              revocation.
            </p>
          </div>
        </label>
      </SectionCard>

      <div className="flex items-center justify-between gap-4">
        <Link to="/dashboard">
          <Button variant="outline" size="sm">
            <BackArrowIcon className="size-4" />
            Save &amp; exit
          </Button>
        </Link>
        <Button variant="primary" size="sm">
          Submit for review
        </Button>
      </div>
    </DashboardShell>
  );
}
