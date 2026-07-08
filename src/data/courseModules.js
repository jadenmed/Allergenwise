export const COURSE_PROGRESS_PERCENT = 52;

export const COURSE_MODULES = [
  {
    id: 1,
    title: "The major allergens",
    lessons: [
      {
        id: 1,
        title: "The big 9",
        completed: true,
        content: {
          description:
            "The nine allergens responsible for the vast majority of reactions, and why the FDA treats them as a distinct labeling category.",
          intro:
            "The FDA recognizes nine major food allergens: milk, eggs, fish, crustacean shellfish, tree nuts, peanuts, wheat, soybeans, and sesame. Together they account for the large majority of allergic reactions in the U.S.",
          bulletsHeading: "How to recognize them on a menu",
          bullets: [
            {
              label: "Direct ingredients.",
              text: "The allergen is listed by name in the recipe — easy to catch, easy to miss under a brand name.",
            },
            {
              label: "Derived ingredients.",
              text: "Whey, casein, and lecithin are common milk and soy derivatives hiding in sauces and dressings.",
            },
            {
              label: "Cross-contact sources.",
              text: "Shared fryers, grills, and prep boards can introduce an allergen even when it's not in the recipe.",
            },
          ],
          secondHeading: "Why it matters in service",
          secondBody:
            "A server who can name the big 9 on sight can catch a risky order before it reaches the kitchen — that's the entire point of this module.",
        },
      },
      {
        id: 2,
        title: "Labeling law",
        completed: true,
        content: {
          description:
            "What FALCPA and the FASTER Act actually require on packaging and how that translates to a restaurant menu.",
          intro:
            "Federal law requires packaged food to disclose major allergens in plain language. Restaurants aren't bound by the same packaging rules, but the same disclosure standard protects you legally and protects your guests.",
          bulletsHeading: "What the law requires",
          bullets: [
            {
              label: "Plain-language naming.",
              text: "\"Milk\" instead of \"casein,\" \"peanut\" instead of \"arachis oil.\"",
            },
            {
              label: "Sesame as the ninth allergen.",
              text: "Added under the FASTER Act — audit your labeling if it hasn't been updated since 2023.",
            },
            {
              label: "State-level add-ons.",
              text: "Some states require an allergy-awareness poster or trained staff on every shift.",
            },
          ],
          secondHeading: "Why it matters in service",
          secondBody:
            "Getting labeling language right isn't just compliance — it's the difference between a guest trusting your menu and asking the server to double-check everything.",
        },
      },
      {
        id: 3,
        title: "Hidden ingredients",
        completed: true,
        content: {
          description:
            "The sauces, garnishes, and shortcuts that introduce allergens without ever appearing on a menu description.",
          intro:
            "Most allergic reactions in restaurants don't come from the obvious ingredient — they come from the sauce, the garnish, or the fryer oil nobody thought to mention.",
          bulletsHeading: "Common blind spots",
          bullets: [
            {
              label: "Thickeners and emulsifiers.",
              text: "Roux (wheat), aioli (egg), and pesto (tree nuts) are easy to overlook.",
            },
            {
              label: "Pre-made components.",
              text: "Vendor-supplied dressings, stocks, and doughs may not match your printed ingredient list.",
            },
            {
              label: "Garnishes and finishes.",
              text: "A sprinkle of crushed peanuts or a butter finish can turn a safe dish unsafe at the pass.",
            },
          ],
          secondHeading: "Why it matters in service",
          secondBody:
            "Every hidden ingredient is a question your staff should be able to answer without walking back to the kitchen mid-service.",
        },
      },
    ],
  },
  {
    id: 2,
    title: "Cross-contact & the kitchen",
    lessons: [
      {
        id: 1,
        title: "Prep surfaces",
        completed: true,
        content: {
          description:
            "How allergens transfer between cutting boards, prep stations, and utensils — and the sanitation standard that stops it.",
          intro:
            "Cross-contact happens when an allergen transfers from one surface or utensil to a dish that's supposed to be free of it. Prep surfaces are the single most common source.",
          bulletsHeading: "The minimum standard",
          bullets: [
            {
              label: "Color-coded boards.",
              text: "Dedicate a board and knife set to allergen-free prep, separate from the general rotation.",
            },
            {
              label: "Full sanitize between uses.",
              text: "A wipe-down isn't enough — allergen proteins require a full wash-rinse-sanitize cycle.",
            },
            {
              label: "Prep order.",
              text: "Prep allergen-free dishes first, before the station has touched any allergen ingredient.",
            },
          ],
          secondHeading: "Why it matters in service",
          secondBody:
            "A clean board takes thirty seconds. A reaction traced back to a dirty one costs a lot more than time.",
        },
      },
      {
        id: 2,
        title: "Shared utensils",
        completed: true,
        content: {
          description:
            "Tongs, ladles, and scoops move between dishes faster than anything else in the kitchen — and carry allergens with them.",
          intro:
            "Shared utensils are convenient and dangerous in equal measure. A single ladle used across a peanut sauce and a \"safe\" dish undoes every other precaution in the kitchen.",
          bulletsHeading: "The minimum standard",
          bullets: [
            {
              label: "One utensil, one dish.",
              text: "Tongs and ladles stay with their station for the shift — no crossing over to plate an allergen-free order.",
            },
            {
              label: "Labeled utensil holders.",
              text: "Color-coded handles make it obvious at a glance which tool belongs where.",
            },
            {
              label: "Reset between allergen orders.",
              text: "Swap to a clean utensil any time an allergen-free ticket comes through.",
            },
          ],
          secondHeading: "Why it matters in service",
          secondBody:
            "This is the fastest cross-contact risk to fix and the easiest one to let slip during a rush.",
        },
      },
      {
        id: 3,
        title: "Fryer protocol",
        completed: false,
        content: {
          description:
            "Shared fryer oil is one of the highest-risk cross-contact points in any kitchen — here's how to manage it safely.",
          intro:
            "A shared fryer means every item cooked in it carries a trace of everything else that's gone through the oil that shift, including allergens like wheat, fish, and shellfish.",
          bulletsHeading: "The minimum standard",
          bullets: [
            {
              label: "Dedicated fryer or basket.",
              text: "Reserve one fryer, or one basket used only at the start of a fresh oil cycle, for allergen-free items.",
            },
            {
              label: "Track the oil's history.",
              text: "Know what's been cooked in the oil since the last change before promising a dish is allergen-free.",
            },
            {
              label: "Communicate the limit.",
              text: "If a dedicated fryer isn't available, say so — don't let a guest assume a fried item is safe by default.",
            },
          ],
          secondHeading: "Why it matters in service",
          secondBody:
            "Fryer cross-contact is invisible to the eye and the palate, which is exactly why it needs a written rule instead of a judgment call.",
        },
      },
    ],
  },
  {
    id: 3,
    title: "Front-of-house & the guest conversation",
    lessons: [
      {
        id: 1,
        title: "Taking the order",
        completed: true,
        content: {
          description:
            "The questions that surface an allergy before the ticket is fired, not after the plate hits the table.",
          intro:
            "The order-taking conversation is the last checkpoint before a ticket reaches the kitchen. A few consistent questions catch most risks before they become incidents.",
          bulletsHeading: "What to ask, every time",
          bullets: [
            {
              label: "\"Any allergies I should flag tonight?\"",
              text: "Ask proactively — don't wait for the guest to bring it up.",
            },
            {
              label: "Severity, not just the allergen.",
              text: "A mild sensitivity and an anaphylaxis risk require very different kitchen handling.",
            },
            {
              label: "Confirm before it's fired.",
              text: "Repeat the allergen back to the guest before sending the ticket.",
            },
          ],
          secondHeading: "Why it matters in service",
          secondBody:
            "Every downstream safeguard in this course depends on the allergy actually making it onto the ticket in the first place.",
        },
      },
      {
        id: 2,
        title: "Menu language & flags",
        completed: false,
        content: {
          description:
            "How to phrase allergen information on the menu so it actually carries weight — and what your ticket flags should communicate to the kitchen.",
          intro:
            "\"Allergy-friendly\" is not a meaningful claim on a menu. It tells the guest nothing about whether your kitchen can actually accommodate their allergen, and it gives your staff no concrete information to act on. The phrases that hold up — legally and operationally — are specific, verifiable, and tied to a real workflow.",
          bulletsHeading: "Ticket flags that actually flow",
          bullets: [
            {
              label: "Ingredient disclosures.",
              text: '"Contains: peanut, soy, milk" — pulled from supplier data, not memory.',
            },
            {
              label: "Preparation claims.",
              text: '"Prepared in a kitchen that handles all major allergens." Honest, doesn\'t overpromise.',
            },
            {
              label: "Process guarantees.",
              text: '"Tree-nut-free menu" — requires a tree-nut-free kitchen process and a supplier audit. Use only if you can prove it.',
            },
          ],
          secondHeading: "What makes a flag actually work",
          secondBody:
            "A ticket flag is only useful if the line cook treats it differently than a normal ticket. The minimum standard: a flagged ticket is prepped on a sanitized station with dedicated utensils, expedited by a specific person, and confirmed verbally to the server before it leaves the pass.",
        },
      },
      {
        id: 3,
        title: "Ticket flow",
        completed: false,
        content: {
          description:
            "How an allergen flag should move from the host stand to the pass without getting lost along the way.",
          intro:
            "A flagged ticket is only as safe as the weakest handoff in the chain — host to server, server to kitchen, kitchen to expo. Each handoff needs its own explicit confirmation step.",
          bulletsHeading: "The minimum standard",
          bullets: [
            {
              label: "Visual flag on the ticket.",
              text: "A printed or handwritten allergen marker that's impossible to miss at a glance.",
            },
            {
              label: "Verbal callout at the pass.",
              text: "Expo calls out the allergen out loud before the plate leaves the kitchen.",
            },
            {
              label: "Server double-check at the table.",
              text: "Confirm the dish with the guest before setting it down.",
            },
          ],
          secondHeading: "Why it matters in service",
          secondBody:
            "Most allergen incidents don't happen because nobody knew — they happen because the information didn't survive the handoff.",
        },
      },
    ],
  },
];
