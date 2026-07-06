import benefitsPhones from "../assets/benefits-phones.png";
import Badge from "./ui/Badge";
import Button from "./ui/Button";

export default function PeaceOfMind() {
  return (
    <section className="w-full flex flex-col items-center justify-center bg-teal-900 px-4 sm:px-6 lg:px-12 py-16 lg:py-24">
      <div className="w-full max-w-[1200px] flex flex-col lg:flex-row gap-10 items-center justify-center">
        <div className="flex-1 min-w-0 flex flex-col gap-6 items-start anim-fade-left">
          <Badge tone="white">For Parents</Badge>
          <div className="flex flex-col gap-2 items-start w-full">
            <h2 className="font-serif font-semibold text-3xl sm:text-4xl lg:text-[40px] leading-tight lg:leading-[48px] text-white w-full">
              The Peace-of-Mind Layer Between You and the Kitchen.
            </h2>
            <p className="text-base sm:text-lg leading-7 text-teal-050 w-full">
              A verified seal isn't a guarantee — it's a credential. It tells
              you the staff was trained, the certificate is real, and the
              record is current. It doesn't replace asking. It makes asking
              less of a leap of faith.
            </p>
          </div>
          <Button variant="outlineOnDark">Try the verification screen</Button>
        </div>
        <div className="shrink-0 w-full max-w-[420px] lg:max-w-[460px] aspect-[420/360] anim-fade-right">
          <img
            src={benefitsPhones}
            alt="AllergenWise verification screens on mobile"
            className="size-full object-contain pointer-events-none"
          />
        </div>
      </div>
    </section>
  );
}
