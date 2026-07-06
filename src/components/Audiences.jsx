import Badge from "./ui/Badge";
import Button from "./ui/Button";
import CheckItem from "./ui/CheckItem";

export default function Audiences() {
  return (
    <section className="w-full flex flex-col items-center justify-center bg-gradient-to-b from-grey-100 to-white px-12 py-24">
      <div className="w-full max-w-[1200px] flex flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-4 max-w-[520px] w-full text-center">
          <Badge>Two audiences, one system</Badge>
          <h2 className="font-serif font-semibold text-4xl leading-[48px] text-teal-950 w-full">
            Whether You Serve Food or Order it
          </h2>
        </div>

        <div className="flex gap-8 items-start w-full">
          <div className="flex-1 min-w-0 h-[488px] flex flex-col gap-8 items-start rounded-2xl border border-grey-300 bg-gradient-to-b from-teal-050 to-white p-8">
            <Badge tone="white">For restaurants</Badge>
            <div className="flex flex-col gap-5 items-start w-full">
              <h3 className="font-serif font-semibold text-2xl leading-8 text-teal-950 w-full">
                Allergen Safety Training for Your Whole Team
              </h3>
              <div className="flex flex-col gap-4 items-start justify-center w-full">
                <CheckItem className="w-full">
                  Self-paced online allergen course your staff finish in an afternoon
                </CheckItem>
                <CheckItem className="w-full">
                  A verifiable public listing and window seal that builds diner trust
                </CheckItem>
                <CheckItem className="w-full">
                  Renewal reminders so your certification never silently lapses
                </CheckItem>
              </div>
            </div>
            <Button size="sm">Get certified</Button>
          </div>

          <div className="flex-1 min-w-0 h-[488px] flex flex-col gap-8 items-start rounded-2xl border border-grey-300 bg-white p-8">
            <Badge>For diners</Badge>
            <div className="flex flex-col gap-5 items-start w-full">
              <h3 className="font-serif font-semibold text-2xl leading-8 text-teal-950 w-full">
                Find Allergy-Friendly Restaurants You Can Trust
              </h3>
              <div className="flex flex-col gap-4 items-start justify-center w-full">
                <CheckItem className="w-full">
                  Search certified restaurants near you, filtered by allergen
                </CheckItem>
                <CheckItem className="w-full">
                  Scan any window seal to confirm a certification is real and current
                </CheckItem>
                <CheckItem className="w-full">
                  No account, no app — it works straight from your phone camera
                </CheckItem>
              </div>
            </div>
            <Button variant="outline" size="sm">
              Find restaurants
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
