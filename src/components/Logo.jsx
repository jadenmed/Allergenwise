import logoTeal from "../assets/logo.svg";
import logoWhite from "../assets/logo-white.svg";

export default function Logo({ dark = false, className = "" }) {
  return (
    <img
      src={dark ? logoWhite : logoTeal}
      alt="AllergenWise"
      className={`h-8 w-[203px] ${className}`}
    />
  );
}

export function LogoMark({ className = "" }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className}>
      <rect x="6.4" y="6.4" width="19.2" height="19.2" opacity="0.12" fill="currentColor" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M31.36 0C31.7135 0 32 .286538 32 .64V31.9975C31.9866 31.999 31.9728 32 31.9589 32H.640039C.286577 32 .0000390625 31.7135 .0000390625 31.36V.64C.0000390625 .286538 .286577 0 .640039 0H31.36ZM2.88004 2.56C2.70331 2.56 2.56004 2.70327 2.56004 2.88V29.12C2.56004 29.2967 2.70331 29.44 2.88004 29.44H4.92332L14.6305 4.88469C14.7271 4.64046 14.963 4.48 15.2257 4.48H17.3507C17.6035 4.48002 17.8326 4.62895 17.9354 4.86L28.8654 29.44H29.12C29.2968 29.44 29.44 29.2967 29.44 29.12V2.88C29.44 2.70327 29.2968 2.56 29.12 2.56H2.88004ZM6.47379 29.44H22.0202L13.7674 10.6036L6.47379 29.44Z"
        fill="currentColor"
      />
    </svg>
  );
}
