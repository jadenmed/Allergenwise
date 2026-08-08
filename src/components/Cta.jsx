import { useNavigate } from "react-router-dom";
import sealCheck from "../assets/seal-check.svg";
import magnifyingGlass from "../assets/magnifying-glass.svg";
import Badge from "./ui/Badge";
import Button from "./ui/Button";

export default function Cta() {
  const navigate = useNavigate();

  return (
    <section className="w-full flex flex-col items-center justify-center bg-gradient-to-b from-teal-050 to-grey-100 px-4 sm:px-6 lg:px-12 py-16 lg:py-24">
      <div className="w-full max-w-[1200px] flex flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-6 max-w-[520px] w-full text-center">
          <Badge tone="tealDark">Get started</Badge>
          <div className="flex flex-col gap-2 items-start w-full">
            <h2 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight sm:leading-[48px] text-teal-950 w-full">
              Trust isn't Claimed, It's Verified
            </h2>
            <p className="text-base leading-6 text-grey-900 w-full">
              Join the restaurants making allergen safety something diners can
              check for themselves.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 items-center justify-center w-full">
          <Button icon={sealCheck} onClick={() => navigate("/sign-up")}>
            Certify your restaurant
          </Button>
          <Button icon={magnifyingGlass} variant="outline" onClick={() => navigate("/verify")}>
            Verify a certificate
          </Button>
        </div>
      </div>
    </section>
  );
}
