export const EXAM_QUESTIONS = [
  {
    prompt:
      "Which of the following is one of the FDA's nine major food allergens, added most recently?",
    options: [
      { letter: "A", text: "Peanuts" },
      { letter: "B", text: "Sesame" },
      { letter: "C", text: "Wheat" },
      { letter: "D", text: "Soy" },
    ],
    correctLetter: "B",
  },
  {
    prompt: '"Contains casein" on an ingredient list indicates the presence of which allergen?',
    options: [
      { letter: "A", text: "Egg" },
      { letter: "B", text: "Soy" },
      { letter: "C", text: "Milk" },
      { letter: "D", text: "Fish" },
    ],
    correctLetter: "C",
  },
  {
    prompt: "Which of these is a common hidden source of soy in a kitchen?",
    options: [
      { letter: "A", text: "Lecithin" },
      { letter: "B", text: "Anchovy paste" },
      { letter: "C", text: "Almond flour" },
      { letter: "D", text: "Shellfish stock" },
    ],
    correctLetter: "A",
  },
  {
    prompt: 'A guest says they\'re allergic to "shellfish." Which item is safest to recommend?',
    options: [
      { letter: "A", text: "Shrimp scampi" },
      { letter: "B", text: "Grilled chicken breast" },
      { letter: "C", text: "Crab cakes" },
      { letter: "D", text: "Lobster bisque" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "What federal law requires plain-language allergen labeling on packaged food?",
    options: [
      { letter: "A", text: "FALCPA" },
      { letter: "B", text: "FDCA" },
      { letter: "C", text: "HACCP" },
      { letter: "D", text: "OSHA" },
    ],
    correctLetter: "A",
  },
  {
    prompt: "What is the safest way to handle a flagged allergy ticket in a shared kitchen?",
    options: [
      { letter: "A", text: "Use the same station but wipe it down after" },
      { letter: "B", text: "Prep on a sanitized station with dedicated utensils" },
      { letter: "C", text: "Ask the guest to accept the risk" },
      { letter: "D", text: "Cook the item last in the same oil" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "Which surface poses the highest cross-contact risk for a gluten allergy?",
    options: [
      { letter: "A", text: "A cutting board also used for bread" },
      { letter: "B", text: "A stainless prep table cleaned between uses" },
      { letter: "C", text: "A fresh produce bin" },
      { letter: "D", text: "A sealed dry-storage shelf" },
    ],
    correctLetter: "A",
  },
  {
    prompt: "Shared fryer oil is a risk for guests allergic to which allergen, even after straining?",
    options: [
      { letter: "A", text: "Milk only" },
      { letter: "B", text: "Peanut only" },
      { letter: "C", text: "Sesame only" },
      { letter: "D", text: "All of the above" },
    ],
    correctLetter: "D",
  },
  {
    prompt: "What is the minimum standard for handling a flagged ticket before it leaves the pass?",
    options: [
      { letter: "A", text: "A visual check only" },
      { letter: "B", text: "Verbal confirmation to the server" },
      { letter: "C", text: "A printed label" },
      { letter: "D", text: "No extra step is needed" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "Which utensil practice best reduces cross-contact risk?",
    options: [
      { letter: "A", text: "Color-coded, allergen-dedicated utensils" },
      { letter: "B", text: "Rinsing utensils between allergen and non-allergen use" },
      { letter: "C", text: "Sharing tongs across stations" },
      { letter: "D", text: "Washing utensils once per shift" },
    ],
    correctLetter: "A",
  },
  {
    prompt: "When should a server ask about allergies?",
    options: [
      { letter: "A", text: "Only if the guest brings it up" },
      { letter: "B", text: "Proactively, with every table" },
      { letter: "C", text: "Only for large parties" },
      { letter: "D", text: "Only when ordering seafood" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "What should a server confirm before sending an allergy ticket to the kitchen?",
    options: [
      { letter: "A", text: "The guest's payment method" },
      { letter: "B", text: "The allergen and severity, repeated back to the guest" },
      { letter: "C", text: "The guest's seating preference" },
      { letter: "D", text: "Nothing further is needed" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "Which menu phrase is the most meaningful and verifiable?",
    options: [
      { letter: "A", text: '"Allergy-friendly"' },
      { letter: "B", text: '"Tree-nut-free menu, audited kitchen process"' },
      { letter: "C", text: '"Made with love"' },
      { letter: "D", text: '"Chef\'s choice"' },
    ],
    correctLetter: "B",
  },
  {
    prompt: "A ticket flag is only useful if:",
    options: [
      { letter: "A", text: "It's printed in a different color" },
      { letter: "B", text: "The kitchen treats it differently than a normal ticket" },
      { letter: "C", text: "It's written in all caps" },
      { letter: "D", text: "The guest sees it" },
    ],
    correctLetter: "B",
  },
  {
    prompt: 'What is the best response to "Is this dish allergy-friendly?"',
    options: [
      { letter: "A", text: '"Yes, absolutely!"' },
      { letter: "B", text: "Ask which allergen, then check with the kitchen" },
      { letter: "C", text: "Ignore the question" },
      { letter: "D", text: "Recommend a different restaurant" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "How often should allergen-related supplier data be reviewed?",
    options: [
      { letter: "A", text: "Never, once verified" },
      { letter: "B", text: "Whenever a recipe or supplier changes" },
      { letter: "C", text: "Only during health inspections" },
      { letter: "D", text: "Every five years" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "What is the safest way to store allergen-containing ingredients?",
    options: [
      { letter: "A", text: "Mixed with all other dry goods" },
      { letter: "B", text: "Labeled and separated from allergen-free stock" },
      { letter: "C", text: "In any available container" },
      { letter: "D", text: "Behind the register" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "Which cleaning method removes allergen residue most reliably?",
    options: [
      { letter: "A", text: "A quick wipe with a dry towel" },
      { letter: "B", text: "Full wash with soap and water on all contact surfaces" },
      { letter: "C", text: "Rinsing with water only" },
      { letter: "D", text: "Spraying air freshener" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "What should trigger a recall response review?",
    options: [
      { letter: "A", text: "A supplier ingredient change without notice" },
      { letter: "B", text: "A slow sales day" },
      { letter: "C", text: "A new hire starting" },
      { letter: "D", text: "A menu redesign" },
    ],
    correctLetter: "A",
  },
  {
    prompt: "Who should be responsible for verifying supplier allergen documentation?",
    options: [
      { letter: "A", text: "No one — it's the supplier's job" },
      { letter: "B", text: "A designated staff member who reviews it regularly" },
      { letter: "C", text: "Whoever is on shift" },
      { letter: "D", text: "The delivery driver" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "What are early signs of anaphylaxis staff should recognize?",
    options: [
      { letter: "A", text: "Hives, swelling, difficulty breathing" },
      { letter: "B", text: "Mild hunger" },
      { letter: "C", text: "Tiredness" },
      { letter: "D", text: "Requesting more water" },
    ],
    correctLetter: "A",
  },
  {
    prompt: "What is the first action if a guest shows signs of a severe allergic reaction?",
    options: [
      { letter: "A", text: "Wait to see if it passes" },
      { letter: "B", text: "Call 911 and use an epinephrine auto-injector if available" },
      { letter: "C", text: "Offer them bread" },
      { letter: "D", text: "Ask them to leave" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "Epinephrine auto-injectors should be administered:",
    options: [
      { letter: "A", text: "Only by a doctor" },
      { letter: "B", text: "By any trained staff member per protocol, if available" },
      { letter: "C", text: "Never at a restaurant" },
      { letter: "D", text: "After calling the guest's family" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "After an allergic reaction incident, staff should:",
    options: [
      { letter: "A", text: "Say nothing and move on" },
      { letter: "B", text: "Document what happened and follow up per protocol" },
      { letter: "C", text: "Blame the kitchen" },
      { letter: "D", text: "Delete the ticket" },
    ],
    correctLetter: "B",
  },
  {
    prompt: "What is the correct sequence during a severe allergic reaction?",
    options: [
      { letter: "A", text: "Call 911, use epinephrine if trained and available, stay with the guest" },
      { letter: "B", text: "Finish other tables first" },
      { letter: "C", text: "Offer a refund only" },
      { letter: "D", text: "Wait for a manager before doing anything" },
    ],
    correctLetter: "A",
  },
];
