import { useState } from "react";
import iconX from "../assets/icon-x.svg";
import iconPlus from "../assets/icon-plus.svg";
import Badge from "./ui/Badge";

const FAQS = [
  {
    question: "Do restaurants need allergen training?",
    answer:
      "It depends on where you operate — some countries, states, and cities legally require allergen training while others treat it as best practice. Requirements change, so confirm the rules with your local food-safety authority. Either way, trained staff reduce real risk to allergic diners and to your business. (Specific legal requirements vary by jurisdiction and should be verified locally.)",
  },
  {
    question: "What does the AllergenWise course cover?",
    answer:
      "The course covers the major food allergens, cross-contact prevention, safe food handling and sanitation practices, and how to respond to an allergic reaction, finishing with a certification exam.",
  },
  {
    question: "How long is an AllergenWise certificate valid?",
    answer:
      "Certificates are valid for one year from the date of issue. We send renewal reminders ahead of the expiration date so your certification never silently lapses.",
  },
  {
    question: "How do diners verify a restaurant's certification?",
    answer:
      "Diners scan the QR code on the tamper-evident window seal with their phone camera — no app or account required — and instantly see whether the certification is real and current.",
  },
  {
    question: "How much does allergen certification cost?",
    answer:
      "Pricing depends on your team size and renewal cadence. Get in touch and we'll put together a quote based on how many staff members need training.",
  },
];

export default function Faq() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="w-full flex flex-col items-center justify-center bg-grey-100 px-12 py-24">
      <div className="w-full max-w-[960px] flex flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-4 max-w-[520px] w-full text-center">
          <Badge>Frequently asked questions</Badge>
          <h2 className="font-serif font-semibold text-4xl leading-[48px] text-teal-950 w-full">
            Common Questions for AllergenWise, Answered
          </h2>
        </div>

        <div className="flex flex-col gap-6 items-start w-full">
          {FAQS.map(({ question, answer }, index) => {
            const isOpen = index === openIndex;
            return (
              <div
                key={question}
                className="flex flex-col items-start w-full rounded-2xl border border-grey-300 bg-white overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? -1 : index)}
                  aria-expanded={isOpen}
                  className="flex gap-5 items-start w-full p-8 cursor-pointer text-left"
                >
                  <p className="flex-1 min-w-0 font-serif font-semibold text-2xl leading-8 text-teal-950">
                    {question}
                  </p>
                  <div className="flex items-center py-1 shrink-0">
                    <img
                      src={isOpen ? iconX : iconPlus}
                      alt=""
                      className="size-6"
                    />
                  </div>
                </button>
                {isOpen && (
                  <div className="flex flex-col items-start w-full px-8 pb-8">
                    <p className="text-base leading-6 text-grey-800 w-full">
                      {answer}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
