import heroPhones from "../assets/hero-phones.png";
import sealCheck from "../assets/seal-check.svg";
import magnifyingGlass from "../assets/magnifying-glass.svg";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import CheckItem from "./ui/CheckItem";

export default function Hero() {
  return (
    <section className="w-full flex flex-col items-center min-h-[800px] bg-grey-100 px-12 pt-40 pb-12">
      <div className="w-full max-w-[1200px] flex items-center gap-12">
        <div
          className="flex flex-col gap-14 items-start w-full max-w-[652px] anim-fade-left"
          style={{ animationDelay: "100ms" }}
        >
          <div className="flex flex-col gap-6 items-start w-full">
            <Badge>Accredited Allergen-safety Certification</Badge>
            <div className="flex flex-col gap-2 w-full">
              <h1 className="font-serif font-semibold text-[48px] leading-[52px] text-teal-950">
                Allergen Safety Certification for Restaurants,{" "}
                <span className="text-teal-700">Verified in Two Seconds</span>
              </h1>
              <p className="text-lg leading-7 text-grey-900">
                Accredited allergen safety training and certification for restaurant
                staff, paired with a tamper-evident QR window seal diners can scan to
                verify your certification is real and current.
              </p>
            </div>
            <div className="flex flex-wrap gap-4 items-center w-full">
              <Button icon={sealCheck}>Certify your restaurant</Button>
              <Button icon={magnifyingGlass} variant="outline">
                Find &amp; verify a restaurant
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 items-center w-full">
            <CheckItem>Independently accredited</CheckItem>
            <CheckItem>Tamper-proof verification</CheckItem>
            <CheckItem>Renewed annually</CheckItem>
          </div>
        </div>
        <div
          className="flex-1 min-w-0 h-[590px] relative anim-fade-right"
          style={{ animationDelay: "250ms" }}
        >
          <img
            src={heroPhones}
            alt="AllergenWise app showing a verified restaurant certification"
            className="absolute inset-0 size-full object-cover pointer-events-none"
          />
        </div>
      </div>
    </section>
  );
}
