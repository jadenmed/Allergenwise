import heroPhones from "../assets/hero-phones.png";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import CheckItem from "./ui/CheckItem";

export default function RestaurantHero() {
  return (
    <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 pt-10 sm:pt-14 lg:pt-20 pb-12 lg:pb-20">
      <div className="w-full max-w-[1200px] flex flex-col lg:flex-row lg:items-center gap-10 lg:gap-12">
        <div
          className="flex flex-col gap-10 lg:gap-14 items-start w-full lg:max-w-[652px] anim-fade-left"
          style={{ animationDelay: "100ms" }}
        >
          <div className="flex flex-col gap-6 items-start w-full">
            <Badge>For Restaurant Owners &amp; Operators</Badge>
            <div className="flex flex-col gap-2 w-full">
              <h1 className="font-serif font-semibold text-3xl sm:text-4xl lg:text-[48px] leading-tight lg:leading-[52px] text-teal-950">
                Make Allergen Safety a Credential — Not a Claim
              </h1>
              <p className="text-base sm:text-lg leading-7 text-grey-900">
                Certify every server, line cook, and manager to an accredited
                standard. Get a tamper-evident QR seal diners can verify
                before they sit down and a public listing that turns allergen
                safety into a competitive advantage.
              </p>
            </div>
            <div className="flex flex-wrap gap-4 items-center w-full">
              <Button>View the course</Button>
              <Button variant="outline">See the owner dashboard</Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 items-center w-full">
            <CheckItem>ID-verified individual credentials</CheckItem>
            <CheckItem>Proctored exam</CheckItem>
            <CheckItem>Renewal reminders 30 days out</CheckItem>
          </div>
        </div>
        <div
          className="w-full max-w-[420px] mx-auto lg:mx-0 lg:max-w-none lg:flex-1 aspect-square lg:aspect-auto lg:h-[590px] relative anim-fade-right"
          style={{ animationDelay: "250ms" }}
        >
          <img
            src={heroPhones}
            alt="AllergenWise owner dashboard and staff certificate on mobile"
            className="absolute inset-0 size-full object-cover pointer-events-none"
          />
        </div>
      </div>
    </section>
  );
}
