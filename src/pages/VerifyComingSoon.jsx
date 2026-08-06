import ComingSoon from "../components/ComingSoon";

export default function VerifyComingSoon() {
  return (
    <ComingSoon
      heading="Public credential verification is coming soon."
      description="We're building a public scan surface so anyone can instantly verify a staff member's certification by QR code or link."
      footnote={
        <>
          During MVP: certifications are being issued and are on record. The
          public scan surface goes live <strong>Q3 2026</strong>.
        </>
      }
    />
  );
}
