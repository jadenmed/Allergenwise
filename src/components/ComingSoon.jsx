import { useState } from "react";
import { LogoMark } from "./Logo";
import Badge from "./ui/Badge";
import Button from "./ui/Button";

export default function ComingSoon({
  eyebrow = "Launching Q3 2026",
  heading,
  description,
  footnote,
  features,
}) {
  const [email, setEmail] = useState("");

  return (
    <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 py-20 lg:py-28">
      <div className="w-full max-w-[640px] rounded-2xl border border-grey-300 bg-white p-8 sm:p-12 shadow-sm flex flex-col items-center gap-6 text-center">
        <div className="flex items-center justify-center size-14 rounded-full bg-teal-100 text-teal-700">
          <LogoMark className="size-7" />
        </div>

        <Badge tone="teal">{eyebrow}</Badge>

        <div className="flex flex-col gap-2">
          <h1 className="font-serif font-semibold text-3xl text-teal-950">
            {heading}
          </h1>
          <p className="text-base text-grey-600 max-w-[480px]">
            {description}
          </p>
        </div>

        <form
          onSubmit={(e) => e.preventDefault()}
          className="w-full flex flex-col sm:flex-row gap-3"
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="flex-1 rounded-lg border border-grey-300 bg-white px-4 py-3 text-base text-teal-950 placeholder-grey-400 focus:outline-none focus:border-teal-700"
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="bg-teal-900 hover:bg-teal-950"
          >
            Notify me
          </Button>
        </form>

        {footnote && (
          <p className="text-sm text-grey-500 max-w-[480px]">{footnote}</p>
        )}
      </div>

      {features && features.length > 0 && (
        <div className="w-full max-w-[900px] grid grid-cols-1 sm:grid-cols-3 gap-6 mt-10">
          {features.map(({ icon: Icon, title, description: desc }) => (
            <div
              key={title}
              className="flex flex-col items-center text-center gap-3 rounded-2xl border border-grey-300 bg-white p-6"
            >
              <div className="flex items-center justify-center size-10 rounded-full bg-teal-100 text-teal-700">
                <Icon className="size-5" />
              </div>
              <p className="text-base font-semibold text-teal-950">{title}</p>
              <p className="text-sm text-grey-600">{desc}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
