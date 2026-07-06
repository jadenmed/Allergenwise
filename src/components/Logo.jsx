import logoTeal from "../assets/logo.svg";
import logoWhite from "../assets/logo-white.svg";

export default function Logo({ dark = false, className = "" }) {
  return (
    <img
      src={dark ? logoWhite : logoTeal}
      alt="AllergenWise"
      className={`h-8 w-auto ${className}`}
    />
  );
}
