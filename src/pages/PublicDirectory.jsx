import ComingSoon from "../components/ComingSoon";

function SearchIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="8.5" cy="8.5" r="6" />
      <path d="M17 17l-4-4" />
    </svg>
  );
}

function QrIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2.5" y="2.5" width="5.5" height="5.5" rx="0.75" />
      <rect x="12" y="2.5" width="5.5" height="5.5" rx="0.75" />
      <rect x="2.5" y="12" width="5.5" height="5.5" rx="0.75" />
      <path d="M12 12h2.5v2.5H12zM15.5 12H17.5V14H15.5zM12 15.5H14V17.5H12zM15.5 15.5H17.5V17.5H15.5z" />
    </svg>
  );
}

function CheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 10.5 8 14.5 16 6" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: SearchIcon,
    title: "Search & discovery",
    description: "Find certified restaurants near you by allergen, cuisine, or location.",
  },
  {
    icon: QrIcon,
    title: "QR verification",
    description: "Scan a restaurant's seal to instantly confirm their certification is current.",
  },
  {
    icon: CheckIcon,
    title: "No app required",
    description: "Everything works right in your browser \u2014 no downloads, no account needed.",
  },
];

export default function PublicDirectory() {
  return (
    <ComingSoon
      heading="The public directory is coming soon."
      description="We're building a diner-facing search experience so anyone can find and verify allergen-certified restaurants nearby."
      footnote={
        <>
          Currently launching with the certification side &middot; MVP live
          now &middot; Full diner directory <strong>Q3 2026</strong>
        </>
      }
      features={FEATURES}
    />
  );
}
