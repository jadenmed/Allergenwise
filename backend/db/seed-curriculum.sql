-- AllergenWise — Curriculum-only seed.
-- Modules + lessons + checkpoint quizzes (shared question bank). No FK to auth.users,
-- safe to run on any environment.
-- Required by tests/e2e/full-pilot-loop.spec.ts (hardcoded module/lesson UUIDs).
-- Apply via: psql $DATABASE_URL -f db/seed-curriculum.sql
--
-- SOURCE OF TRUTH: content/curriculum/source/AllergenWise_Curriculum_Source.pdf
-- Everything here is transcribed verbatim from that file. Nothing is invented.
-- Where the file supplies no content, the grep-able missing-content marker
-- (an HTML comment reading "CONTENT MISSING — not provided in source file")
-- is used (never placeholder prose).
--
-- Structure (AllergenWise Curriculum Source):
--   5 sections (module UUIDs c1000000-…-0001 through 0005 PRESERVED),
--   20 lessons total (3 / 4 / 4 / 3 / 6).
--
-- Content coverage from the source file:
--   FULL CONTENT (verbatim body + Checkpoint Quiz): Lessons 1.1–4.3.
--   OUTLINE ONLY in the file → body + quiz are the missing-content marker:
--     Lessons 5.1–5.6.
--   Final Certification Test question pool: NOT in the file → pool left empty.
--
-- Checkpoint quizzes: the source ships 3–5 questions per lesson. Those are seeded
-- into the SHARED question bank (migration 0018_shared_question_bank): one
-- `questions` row per question (lesson_id-tagged, is_exam_eligible=false) plus
-- one `question_choices` row per option. The legacy single-question
-- lessons.quick_check_* columns are DEPRECATED but kept populated with each
-- lesson's FIRST question so the existing lesson player keeps working.
--
-- The Final Certification Test draws from the SAME bank (is_exam_eligible=true,
-- lesson_id NULL). The source provides no exam pool, so none is seeded here and
-- /api/exam/start returns "content pending" until it is.

-- ─── Modules (5 sections — UUIDs PRESERVED) ──────────────────────────────────

insert into modules (id, order_index, title, description, estimated_minutes) values
  ('c1000000-0000-0000-0000-000000000001', 1, 'Foundations of Food Allergens',
   'Foundations of food allergens: what a food allergy is, the FDA Top 9 allergens, and allergic reactions and anaphylaxis.', 25),
  ('c1000000-0000-0000-0000-000000000002', 2, 'Cross-Contact and Safe Handling Procedures',
   'Cross-contact and safe handling: understanding cross-contact, cleaning and kitchen safety, handwashing and gloves, and preventing cross-contact during preparation.', 30),
  ('c1000000-0000-0000-0000-000000000003', 3, 'Front of House Communication and Guest Interaction',
   'Front of house communication: identifying and responding to allergy disclosures, order communication and the AllergenWise workflow, managing guest expectations, and recognizing allergic reactions.', 25),
  ('c1000000-0000-0000-0000-000000000004', 4, 'Back of House Procedures and Execution',
   'Back of house procedures: ingredient verification and hidden risks, safe kitchen execution, and final verification before service.', 20),
  ('c1000000-0000-0000-0000-000000000005', 5, 'Systems, Management, and Legal Risk Reduction',
   'Systems, management, and legal risk reduction: the AllergenWise Risk Reduction Workflow, manager decision making, labeling systems, legal protection, high-risk situations, and daily practices.', 35)
on conflict (id) do update set
  order_index       = excluded.order_index,
  title             = excluded.title,
  description       = excluded.description,
  estimated_minutes = excluded.estimated_minutes;

-- ─── Lessons (20 total: 3 / 4 / 4 / 3 / 6) ───────────────────────────────────
-- Deterministic UUIDs: d1000000-0000-0000-0000-0000000000{section}{lesson_2digit}.
-- body_md: verbatim Lesson Content (Lessons 1.1–4.3) or the missing-content
-- marker (5.1–5.6). quick_check_* (DEPRECATED) holds each lesson's FIRST
-- Checkpoint Quiz question; 5.1–5.6 hold the marker with empty options.

insert into lessons (id, module_id, order_index, title, body_md, video_duration_seconds, quick_check_question, quick_check_options) values
  -- ── Section 1 — Foundations of Food Allergens ──
  ('d1000000-0000-0000-0000-000000000101', 'c1000000-0000-0000-0000-000000000001', 1,
   'What Is a Food Allergy?',
   E'A food allergy is an immune system reaction to a food protein. Unlike food preferences or intolerances, allergic reactions can become serious and life-threatening.\n\nEven a small amount of an allergen can trigger a reaction in sensitive individuals.\n\nRestaurants must take all allergy disclosures seriously.\n\nThis training is designed to help restaurants reduce allergen risk through education, communication, and structured procedures.\n\nNo restaurant can guarantee a completely allergen-free environment. The goal of this program is to improve awareness, reduce preventable mistakes, and support safer food handling practices.\n\n## Key Concepts\n\n- Food allergies involve the immune system\n- Small amounts of allergens can trigger reactions\n- Allergic reactions can become severe quickly\n- Restaurants should focus on risk reduction, not guarantees\n- Honest communication is critical', 180,
   'What is a food allergy?',
   '[{"id":"a","text":"A food preference","correct":false},{"id":"b","text":"A diet choice","correct":false},{"id":"c","text":"An immune system reaction to a food protein","correct":true},{"id":"d","text":"A mild intolerance","correct":false}]'::jsonb),
  ('d1000000-0000-0000-0000-000000000102', 'c1000000-0000-0000-0000-000000000001', 2,
   'Understanding the Top 9 Food Allergens',
   E'The FDA identifies 9 major food allergens responsible for the majority of serious allergic reactions in the United States.\n\nEvery restaurant staff member should be familiar with these allergens.\n\n1. **Milk (Dairy)** — Milk is found in cheese, butter, cream sauces, soups, dressings, and many prepared foods.\n\n   Common restaurant examples include:\n   - Alfredo sauce\n   - Ranch dressing\n   - Mashed potatoes\n   - Cream soups\n   - Cheese blends\n2. **Eggs** — Eggs are commonly used in baking, sauces, breading, desserts, and pasta.\n\n   Common restaurant examples include:\n   - Mayonnaise\n   - Aioli\n   - Pancake batter\n   - Fried food breading\n   - Desserts\n3. **Peanuts** — Peanuts are a separate allergen from tree nuts and may appear in oils, sauces, desserts, and Asian dishes.\n\n   Common restaurant examples include:\n   - Peanut oil\n   - Peanut sauces\n   - Dessert toppings\n   - Asian marinades\n4. **Tree Nuts** — Tree nuts include almonds, walnuts, cashews, pecans, pistachios, and more.\n\n   Common restaurant examples include:\n   - Pesto\n   - Nut garnishes\n   - Desserts\n   - Nut oils\n5. **Soy** — Soy is commonly found in sauces, marinades, dressings, and processed foods.\n\n   Common restaurant examples include:\n   - Soy sauce\n   - Teriyaki sauce\n   - Marinades\n   - Dressings\n6. **Wheat** — Wheat is a grain found in bread, pasta, breading, flour, and many sauces.\n\n   Common restaurant examples include:\n   - Bread\n   - Pasta\n   - Roux\n   - Fried food breading\n   - Soy sauce\n7. **Fish** — Fish includes finned fish such as salmon, tuna, cod, and others.\n\n   Common restaurant examples include:\n   - Fish sauce\n   - Caesar dressing\n   - Seafood dishes\n   - Stocks\n8. **Shellfish** — Shellfish includes shrimp, crab, lobster, clams, scallops, and oysters.\n\n   Common restaurant examples include:\n   - Shrimp dishes\n   - Oyster sauce\n   - Seafood stock\n   - Crab mixtures\n9. **Sesame** — Sesame is increasingly common in restaurant foods.\n\n   Common restaurant examples include:\n   - Tahini\n   - Sesame oil\n   - Burger buns\n   - Dressings\n   - Asian sauces\n\n> **Important:**\n> Allergens may not always be visible or obvious.\n>\n> Staff should never guess whether a dish is safe.\n>\n> Ingredients must always be verified.', 180,
   'Which of the following is one of the Top 9 allergens?',
   '[{"id":"a","text":"Chicken","correct":false},{"id":"b","text":"Beef","correct":false},{"id":"c","text":"Peanuts","correct":true},{"id":"d","text":"Rice","correct":false}]'::jsonb),
  ('d1000000-0000-0000-0000-000000000103', 'c1000000-0000-0000-0000-000000000001', 3,
   'Understanding Allergic Reactions and Anaphylaxis',
   E'Allergic reactions can range from mild symptoms to severe, life-threatening emergencies.\n\nA severe allergic reaction is called anaphylaxis.\n\nAnaphylaxis can happen quickly and requires immediate action.\n\nCommon symptoms may include:\n\n- Hives or rash\n- Swelling of the lips, face, or throat\n- Difficulty breathing\n- Wheezing\n- Vomiting\n- Dizziness or fainting\n- Tightness in the chest\n\nRestaurants should always take allergic reactions seriously.\n\nIf a severe reaction is suspected:\n\n- Alert a manager immediately\n- Call 911\n- Stay with the guest\n- Never assume symptoms will improve on their own\n\n## Key Concepts\n\n- Allergic reactions can escalate quickly\n- Immediate action matters\n- Staff should never ignore symptoms\n- Emergency response awareness is critical', 180,
   'What is the term for a severe allergic reaction?',
   '[{"id":"a","text":"Contamination","correct":false},{"id":"b","text":"Cross-contact","correct":false},{"id":"c","text":"Anaphylaxis","correct":true},{"id":"d","text":"Intolerance","correct":false}]'::jsonb),
  -- ── Section 2 — Cross-Contact and Safe Handling Procedures ──
  ('d1000000-0000-0000-0000-000000000201', 'c1000000-0000-0000-0000-000000000002', 1,
   'Understanding Cross-Contact',
   E'Cross-contact occurs when allergen proteins are transferred from one food, surface, utensil, or piece of equipment to another.\n\nEven very small amounts of an allergen can trigger a serious allergic reaction.\n\nCross-contact is different from bacterial contamination.\n\nExamples of cross-contact include:\n\n- Using the same cutting board for multiple foods without proper cleaning\n- Shared fryer oil\n- Shared grill surfaces\n- Reusing utensils between dishes\n- Touching allergen-containing food and then touching another dish\n\n> **Important:**\n> Cooking does NOT remove allergens.\n>\n> A dish may appear safe while still containing allergen proteins.\n\n## Key Concepts\n\n- Cross-contact can happen easily in busy kitchens\n- Small amounts of allergens can cause reactions\n- Shared equipment increases risk\n- Awareness and proper procedures reduce risk', 180,
   'What is cross-contact?',
   '[{"id":"a","text":"Food spoilage","correct":false},{"id":"b","text":"Bacteria growth","correct":false},{"id":"c","text":"Transfer of allergen proteins from one food or surface to another","correct":true},{"id":"d","text":"Overcooking food","correct":false}]'::jsonb),
  ('d1000000-0000-0000-0000-000000000202', 'c1000000-0000-0000-0000-000000000002', 2,
   'Cleaning and Kitchen Safety Procedures',
   E'Proper cleaning procedures are essential for reducing allergen risk.\n\nSimply wiping a surface is not enough to remove allergen proteins.\n\nStaff should:\n\n- Clean and sanitize prep surfaces thoroughly\n- Use clean utensils and tools\n- Separate allergen-containing foods when possible\n- Maintain organized prep areas\n\nHigh-risk equipment includes:\n\n- Shared fryers\n- Shared grills\n- Flat tops\n- Shared prep surfaces\n- Shared pasta water\n\n> **Important:**\n> Shared fryer oil can transfer allergen proteins between foods.\n\nFor example:\nFrench fries cooked in oil previously used for breaded shrimp may no longer be safe for some guests with shellfish allergies.\n\n## Key Concepts\n\n- Cleaning reduces allergen risk\n- Wiping alone is not enough\n- Shared equipment increases risk\n- Organized prep procedures improve safety', 180,
   'Why is wiping a surface not enough?',
   '[{"id":"a","text":"It changes food taste","correct":false},{"id":"b","text":"It takes too long","correct":false},{"id":"c","text":"Wiping may not remove allergen proteins","correct":true},{"id":"d","text":"It only affects appearance","correct":false}]'::jsonb),
  ('d1000000-0000-0000-0000-000000000203', 'c1000000-0000-0000-0000-000000000002', 3,
   'Handwashing, Gloves, and Safe Handling Procedures',
   E'Gloves alone do NOT prevent allergen cross-contact.\n\nHands must be properly washed before changing gloves and before handling allergy-sensitive food.\n\nProper procedures include:\n\n- Washing hands thoroughly with soap and water\n- Changing gloves between tasks\n- Washing hands after touching allergen-containing food\n- Avoiding contact with multiple surfaces unnecessarily\n- Using clean utensils and prep areas\n\n> **Important:**\n> Wiping gloves or continuing to use the same gloves does NOT make them safe.\n>\n> Gloves can spread allergens just like hands.\n\n## Key Concepts\n\n- Gloves are not a replacement for handwashing\n- Proper handwashing reduces allergen transfer\n- Gloves must be changed appropriately\n- Safe handling procedures reduce risk', 180,
   'Do gloves alone prevent allergen cross-contact?',
   '[{"id":"a","text":"Yes","correct":false},{"id":"b","text":"Sometimes","correct":false},{"id":"c","text":"No, gloves alone do not prevent cross-contact","correct":true},{"id":"d","text":"Only during prep","correct":false}]'::jsonb),
  ('d1000000-0000-0000-0000-000000000204', 'c1000000-0000-0000-0000-000000000002', 4,
   'Preventing Cross-Contact During Preparation',
   E'Allergy-sensitive meals should be prepared carefully using structured procedures.\n\nStaff should:\n\n- Use clean prep surfaces\n- Use clean or separate utensils\n- Verify ingredients before use\n- Keep allergy orders separate from other foods\n- Avoid placing allergy-safe dishes near allergen-containing foods\n\nWhenever possible:\n\n- Use dedicated prep areas\n- Use separate equipment\n- Minimize unnecessary exposure to allergens\n\n> **Important:**\n> Never guess whether a dish is safe.\n\nIf there is uncertainty:\n\n- Stop the process\n- Ask a manager\n- Verify ingredients and procedures\n\n## Key Concepts\n\n- Organized preparation reduces risk\n- Separation is important\n- Ingredient verification is critical\n- Uncertainty should always be escalated', 180,
   'What should staff do before preparing an allergy-sensitive meal?',
   '[{"id":"a","text":"Begin cooking immediately","correct":false},{"id":"b","text":"Ignore nearby foods","correct":false},{"id":"c","text":"Use clean prep surfaces and verify ingredients","correct":true},{"id":"d","text":"Reuse utensils","correct":false}]'::jsonb),
  -- ── Section 3 — Front of House Communication and Guest Interaction ──
  ('d1000000-0000-0000-0000-000000000301', 'c1000000-0000-0000-0000-000000000003', 1,
   'Identifying and Responding to Allergy Disclosures',
   E'Front of house staff are often the first line of communication when a guest reports a food allergy.\n\nAll allergy disclosures must be taken seriously.\n\nStaff should:\n\n- Listen carefully to the guest\n- Identify the specific allergen\n- Clarify any uncertainty respectfully\n- Notify the kitchen clearly\n- Escalate to management when needed\n\n> **Important:**\n> Staff should never dismiss or minimize a guest’s allergy.\n\nExamples of appropriate responses:\n\n- “Thank you for letting me know.”\n- “I’ll communicate this with the kitchen immediately.”\n- “Let me confirm the ingredients and preparation process for you.”\n\nExamples to avoid:\n\n- “You’ll probably be okay.”\n- “We’ve never had a problem before.”\n- “Just pick it off.”\n\n## Key Concepts\n\n- Allergy disclosures require immediate attention\n- Clear communication reduces risk\n- Guests should be treated respectfully and seriously\n- Escalation is appropriate when uncertain', 180,
   'What should staff do when a guest reports a food allergy?',
   '[{"id":"a","text":"Ignore the concern","correct":false},{"id":"b","text":"Assume it is minor","correct":false},{"id":"c","text":"Take the allergy seriously and communicate it clearly","correct":true},{"id":"d","text":"Continue service without changes","correct":false}]'::jsonb),
  ('d1000000-0000-0000-0000-000000000302', 'c1000000-0000-0000-0000-000000000003', 2,
   'Order Communication and Allergy Workflow',
   E'Allergy orders should follow a clear communication workflow to reduce mistakes and improve consistency.\n\nThe AllergenWise Risk Reduction Workflow:\n\n1. Guest informs staff\n2. Front of house confirms the allergen\n3. Allergy alert is entered clearly into the POS/KDS system\n4. Kitchen is notified of the allergy\n5. Ingredients and preparation methods are verified\n6. Safe handling procedures are followed\n7. Manager verification occurs when needed\n8. Final confirmation is completed before service\n9. Honest communication is maintained with the guest\n\n> **Important:**\n> Staff should never assume the kitchen saw the allergy note.\n\nDuring busy shifts, verbal communication may also be necessary.\n\nExamples of effective communication:\n\n- Clearly labeling “SESAME ALLERGY” in the system\n- Verbally notifying the kitchen when necessary\n- Confirming modifications before serving\n\n## Key Concepts\n\n- Structured workflows reduce mistakes\n- Clear allergy alerts are critical\n- Communication between FOH and BOH matters\n- Verification should happen at every stage', 180,
   'What is the purpose of the AllergenWise Risk Reduction Workflow?',
   '[{"id":"a","text":"Increase menu options","correct":false},{"id":"b","text":"Speed up service","correct":false},{"id":"c","text":"Reduce allergen risk through structured communication and procedures","correct":true},{"id":"d","text":"Reduce staffing needs","correct":false}]'::jsonb),
  ('d1000000-0000-0000-0000-000000000303', 'c1000000-0000-0000-0000-000000000003', 3,
   'Managing Guest Expectations',
   E'Restaurants should communicate honestly and responsibly with guests regarding food allergies.\n\nNo restaurant can guarantee a completely allergen-free environment.\n\nStaff should avoid making guarantees about safety.\n\nAppropriate language includes:\n\n- “We take allergies seriously and will take precautions.”\n- “Let me confirm the preparation process for you.”\n- “We cannot guarantee a completely allergen-free environment.”\n\nAvoid statements such as:\n\n- “You’ll be fine.”\n- “There is no risk.”\n- “We guarantee it’s safe.”\n\nIf a dish cannot be safely prepared:\n\n- Inform the guest honestly\n- Escalate to management\n- Offer alternatives when appropriate\n\n> **Important:**\n> Being honest about limitations helps reduce risk and supports responsible communication.\n\n## Key Concepts\n\n- Restaurants should avoid guarantees\n- Honest communication is important\n- Safety should come before service speed\n- Guests deserve clear information', 180,
   'Can a restaurant guarantee a completely allergen-free environment?',
   '[{"id":"a","text":"Yes","correct":false},{"id":"b","text":"Only with trained staff","correct":false},{"id":"c","text":"No, restaurants cannot guarantee a completely allergen-free environment","correct":true},{"id":"d","text":"Only during slow hours","correct":false}]'::jsonb),
  ('d1000000-0000-0000-0000-000000000304', 'c1000000-0000-0000-0000-000000000003', 4,
   'Recognizing and Responding to Allergic Reactions',
   E'Even when proper procedures are followed, allergic reactions may still occur.\n\nStaff should recognize the signs of a possible allergic reaction and respond immediately.\n\nCommon symptoms include:\n\n- Hives or rash\n- Swelling of the lips, face, or throat\n- Difficulty breathing\n- Wheezing\n- Vomiting\n- Dizziness or fainting\n- Tightness in the chest\n\nA severe allergic reaction is called anaphylaxis and can become life-threatening quickly.\n\nIf a severe reaction is suspected:\n\n1. Alert a manager immediately\n2. Call 911\n3. Stay with the guest\n4. Monitor the guest’s condition\n5. Assist with an EpiPen if requested\n\n> **Important:**\n> - Never wait to see if symptoms improve\n> - Never leave the guest alone\n> - All reactions should be taken seriously\n\n## Key Concepts\n\n- Allergic reactions can escalate quickly\n- Immediate action matters\n- Staff should remain calm and responsive\n- Emergency awareness is critical', 180,
   'Which of the following may be a sign of a severe allergic reaction?',
   '[{"id":"a","text":"Mild hunger","correct":false},{"id":"b","text":"Fatigue","correct":false},{"id":"c","text":"Difficulty breathing or throat swelling","correct":true},{"id":"d","text":"Tiredness","correct":false}]'::jsonb),
  -- ── Section 4 — Back of House Procedures and Execution ──
  -- (Source full-content section gives no Lesson Purpose and no Key Concepts for 4.1–4.3.)
  ('d1000000-0000-0000-0000-000000000401', 'c1000000-0000-0000-0000-000000000004', 1,
   'Ingredient Verification and Hidden Risks',
   E'Before preparing an allergy-sensitive meal, ingredients must always be verified.\n\nStaff should never assume a dish is safe based on appearance or past experience.\n\nHidden allergens may exist in:\n\n- Sauces\n- Marinades\n- Dressings\n- Spice blends\n- Packaged ingredients\n- Fryer coatings\n- Prepared foods\n\nStaff should:\n\n- Check ingredient labels when available\n- Confirm ingredients with management when uncertain\n- Review sauces and pre-made items carefully\n- Stop and verify if unsure\n\n> **Important:**\n> Never guess whether an ingredient contains an allergen.\n>\n> If ingredients cannot be verified, the safest decision may be to avoid serving the dish.', 180,
   'Why should ingredients always be verified before preparing an allergy-sensitive meal?',
   '[{"id":"a","text":"To improve presentation","correct":false},{"id":"b","text":"To reduce food cost","correct":false},{"id":"c","text":"Hidden allergens may exist in sauces, marinades, and prepared foods","correct":true},{"id":"d","text":"To speed up service","correct":false}]'::jsonb),
  ('d1000000-0000-0000-0000-000000000402', 'c1000000-0000-0000-0000-000000000004', 2,
   'Safe Kitchen Execution Procedures',
   E'Allergy-sensitive meals should follow structured kitchen procedures designed to reduce cross-contact risk.\n\nBefore preparation begins:\n\n- Identify the allergy clearly\n- Prepare a clean workspace\n- Use clean utensils and tools\n- Separate allergen-containing foods when possible\n\nDuring preparation:\n\n- Keep allergy orders separate from other dishes\n- Avoid unnecessary exposure to allergens\n- Use clean gloves and wash hands appropriately\n- Maintain awareness throughout preparation\n\nHigh-risk situations include:\n\n- Shared fryers\n- Shared grills\n- Shared prep surfaces\n- Shared utensils\n\n> **Important:**\n> Even small mistakes during preparation can create allergen risk.', 180,
   'What should staff do before preparing an allergy-sensitive meal?',
   '[{"id":"a","text":"Begin cooking immediately","correct":false},{"id":"b","text":"Reuse dirty utensils","correct":false},{"id":"c","text":"Prepare a clean workspace and identify the allergy clearly","correct":true},{"id":"d","text":"Ignore nearby foods","correct":false}]'::jsonb),
  ('d1000000-0000-0000-0000-000000000403', 'c1000000-0000-0000-0000-000000000004', 3,
   'Final Verification Before Service',
   E'Before an allergy-sensitive dish is served, a final verification step should be completed.\n\nStaff should confirm:\n\n- The correct ingredients were used\n- Modifications were completed properly\n- No allergen-containing garnish or ingredient was added\n- The dish matches the allergy request\n\nStaff should also:\n\n- Visually inspect the plate\n- Confirm the correct guest will receive the dish\n- Communicate clearly with front of house staff when needed\n\n> **Important:**\n> The final verification step should never be rushed.\n>\n> A mistake at the final stage can still expose a guest to allergens.', 180,
   'What is the purpose of final verification before service?',
   '[{"id":"a","text":"Improve food presentation","correct":false},{"id":"b","text":"Speed up service","correct":false},{"id":"c","text":"Confirm the dish was prepared safely and correctly","correct":true},{"id":"d","text":"Reduce food cost","correct":false}]'::jsonb),
  -- ── Section 5 — Systems, Management, and Legal Risk Reduction ──
  -- Source provides OUTLINE ONLY for 5.1–5.6 (no body prose, no quiz questions).
  -- body_md and the checkpoint quiz are the missing-content marker; nothing invented.
  ('d1000000-0000-0000-0000-000000000501', 'c1000000-0000-0000-0000-000000000005', 1,
   'The AllergenWise Risk Reduction Workflow',
   E'<!-- CONTENT MISSING — not provided in source file -->', 180,
   '<!-- CONTENT MISSING — not provided in source file -->',
   '[]'::jsonb),
  ('d1000000-0000-0000-0000-000000000502', 'c1000000-0000-0000-0000-000000000005', 2,
   'Manager Decision Making and Escalation',
   E'<!-- CONTENT MISSING — not provided in source file -->', 180,
   '<!-- CONTENT MISSING — not provided in source file -->',
   '[]'::jsonb),
  ('d1000000-0000-0000-0000-000000000503', 'c1000000-0000-0000-0000-000000000005', 3,
   'Menu, Labeling, and Allergen Awareness Systems',
   E'<!-- CONTENT MISSING — not provided in source file -->', 180,
   '<!-- CONTENT MISSING — not provided in source file -->',
   '[]'::jsonb),
  ('d1000000-0000-0000-0000-000000000504', 'c1000000-0000-0000-0000-000000000005', 4,
   'Legal Protection and Risk Awareness',
   E'<!-- CONTENT MISSING — not provided in source file -->', 180,
   '<!-- CONTENT MISSING — not provided in source file -->',
   '[]'::jsonb),
  ('d1000000-0000-0000-0000-000000000505', 'c1000000-0000-0000-0000-000000000005', 5,
   'High-Risk Situations and Special Considerations',
   E'<!-- CONTENT MISSING — not provided in source file -->', 180,
   '<!-- CONTENT MISSING — not provided in source file -->',
   '[]'::jsonb),
  ('d1000000-0000-0000-0000-000000000506', 'c1000000-0000-0000-0000-000000000005', 6,
   'Daily Allergen Safety Practices',
   E'<!-- CONTENT MISSING — not provided in source file -->', 180,
   '<!-- CONTENT MISSING — not provided in source file -->',
   '[]'::jsonb)
on conflict (id) do update set
  module_id              = excluded.module_id,
  order_index            = excluded.order_index,
  title                  = excluded.title,
  body_md                = excluded.body_md,
  video_duration_seconds = excluded.video_duration_seconds,
  quick_check_question   = excluded.quick_check_question,
  quick_check_options    = excluded.quick_check_options;

-- Remove any stale lessons from a previous scaffold whose UUIDs are no longer
-- part of the 20-lesson architecture. Safe no-op on a fresh DB.
delete from lessons
 where module_id in (
   'c1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000002',
   'c1000000-0000-0000-0000-000000000003',
   'c1000000-0000-0000-0000-000000000004',
   'c1000000-0000-0000-0000-000000000005'
 )
 and id not in (
   'd1000000-0000-0000-0000-000000000101','d1000000-0000-0000-0000-000000000102','d1000000-0000-0000-0000-000000000103',
   'd1000000-0000-0000-0000-000000000201','d1000000-0000-0000-0000-000000000202','d1000000-0000-0000-0000-000000000203','d1000000-0000-0000-0000-000000000204',
   'd1000000-0000-0000-0000-000000000301','d1000000-0000-0000-0000-000000000302','d1000000-0000-0000-0000-000000000303','d1000000-0000-0000-0000-000000000304',
   'd1000000-0000-0000-0000-000000000401','d1000000-0000-0000-0000-000000000402','d1000000-0000-0000-0000-000000000403',
   'd1000000-0000-0000-0000-000000000501','d1000000-0000-0000-0000-000000000502','d1000000-0000-0000-0000-000000000503','d1000000-0000-0000-0000-000000000504','d1000000-0000-0000-0000-000000000505','d1000000-0000-0000-0000-000000000506'
 );

-- ─── Checkpoint quizzes (shared question bank — 0018_shared_question_bank) ────
-- Verbatim from the source. Staged into a temp table (the exact (lesson_id,
-- order_index, question, options) tuples the source defines), then expanded into
-- the shared bank below: one `questions` row per question + one `question_choices`
-- row per option. Deterministic ids (md5 of a stable key, cast to uuid) keep
-- re-seeds idempotent. Lessons 5.1–5.6 are outline-only → a single
-- missing-content marker row each (empty options); staged but NOT promoted into
-- the bank.
--
-- Wrapped in a transaction so the ON COMMIT DROP temp table survives between the
-- stage INSERT and the expansion (psql -f autocommits each statement otherwise).
begin;

create temp table _seed_quiz (
  lesson_id            uuid,
  order_index          int,
  question             text,
  options              jsonb,
  correct_option_index int
) on commit drop;

insert into _seed_quiz (lesson_id, order_index, question, options, correct_option_index) values
  -- Lesson 1.1 (4)
  ('d1000000-0000-0000-0000-000000000101', 1, 'What is a food allergy?',
   '[{"text":"A food preference","correct":false},{"text":"A diet choice","correct":false},{"text":"An immune system reaction to a food protein","correct":true},{"text":"A mild intolerance","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000101', 2, 'Can small amounts of an allergen cause a reaction?',
   '[{"text":"No","correct":false},{"text":"Only in children","correct":false},{"text":"Yes, even small amounts can trigger a reaction","correct":true},{"text":"Only if raw","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000101', 3, 'What is the purpose of this training program?',
   '[{"text":"Guarantee allergen-free food","correct":false},{"text":"Eliminate all restaurant risk","correct":false},{"text":"Reduce allergen risk through awareness and structured procedures","correct":true},{"text":"Replace restaurant management","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000101', 4, 'Can a restaurant guarantee a completely allergen-free environment?',
   '[{"text":"Yes","correct":false},{"text":"Only with trained staff","correct":false},{"text":"No, restaurants cannot guarantee a completely allergen-free environment","correct":true},{"text":"Only during slow hours","correct":false}]'::jsonb, 2),
  -- Lesson 1.2 (5)
  ('d1000000-0000-0000-0000-000000000102', 1, 'Which of the following is one of the Top 9 allergens?',
   '[{"text":"Chicken","correct":false},{"text":"Beef","correct":false},{"text":"Peanuts","correct":true},{"text":"Rice","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000102', 2, 'Which allergen is commonly found in tahini and sesame oil?',
   '[{"text":"Soy","correct":false},{"text":"Wheat","correct":false},{"text":"Sesame","correct":true},{"text":"Fish","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000102', 3, 'Why should staff verify ingredients instead of guessing?',
   '[{"text":"To improve food presentation","correct":false},{"text":"To reduce food cost","correct":false},{"text":"Allergens may be hidden in ingredients or sauces","correct":true},{"text":"To speed up service","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000102', 4, 'Which of the following is a common hidden source of wheat?',
   '[{"text":"Water","correct":false},{"text":"Rice","correct":false},{"text":"Soy sauce","correct":true},{"text":"Lettuce","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000102', 5, 'Are peanuts and tree nuts the same allergen?',
   '[{"text":"Yes","correct":false},{"text":"No, peanuts and tree nuts are separate allergens","correct":true},{"text":"Only in desserts","correct":false},{"text":"Only in sauces","correct":false}]'::jsonb, 1),
  -- Lesson 1.3 (4)
  ('d1000000-0000-0000-0000-000000000103', 1, 'What is the term for a severe allergic reaction?',
   '[{"text":"Contamination","correct":false},{"text":"Cross-contact","correct":false},{"text":"Anaphylaxis","correct":true},{"text":"Intolerance","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000103', 2, 'Which of the following may be a symptom of a severe allergic reaction?',
   '[{"text":"Mild hunger","correct":false},{"text":"Headache","correct":false},{"text":"Difficulty breathing","correct":true},{"text":"Fatigue","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000103', 3, 'What should staff do if a severe allergic reaction is suspected?',
   '[{"text":"Wait to see if symptoms improve","correct":false},{"text":"Ignore the situation","correct":false},{"text":"Alert a manager and call 911 immediately","correct":true},{"text":"Continue service","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000103', 4, 'Should allergic reactions always be taken seriously?',
   '[{"text":"No","correct":false},{"text":"Only if severe","correct":false},{"text":"Yes, all allergic reactions should be taken seriously","correct":true},{"text":"Only during busy shifts","correct":false}]'::jsonb, 2),
  -- Lesson 2.1 (4)
  ('d1000000-0000-0000-0000-000000000201', 1, 'What is cross-contact?',
   '[{"text":"Food spoilage","correct":false},{"text":"Bacteria growth","correct":false},{"text":"Transfer of allergen proteins from one food or surface to another","correct":true},{"text":"Overcooking food","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000201', 2, 'Can small amounts of an allergen cause a reaction?',
   '[{"text":"No","correct":false},{"text":"Only if raw","correct":false},{"text":"Yes, even small amounts may trigger a reaction","correct":true},{"text":"Only during cooking","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000201', 3, 'Which of the following is an example of cross-contact?',
   '[{"text":"Using clean utensils","correct":false},{"text":"Washing hands","correct":false},{"text":"Using the same cutting board without cleaning it properly","correct":true},{"text":"Using sealed ingredients","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000201', 4, 'Does cooking remove allergens from food?',
   '[{"text":"Yes","correct":false},{"text":"Sometimes","correct":false},{"text":"No, cooking does not remove allergens","correct":true},{"text":"Only frying works","correct":false}]'::jsonb, 2),
  -- Lesson 2.2 (4)
  ('d1000000-0000-0000-0000-000000000202', 1, 'Why is wiping a surface not enough?',
   '[{"text":"It changes food taste","correct":false},{"text":"It takes too long","correct":false},{"text":"Wiping may not remove allergen proteins","correct":true},{"text":"It only affects appearance","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000202', 2, 'Which kitchen equipment is considered high-risk for cross-contact?',
   '[{"text":"Sealed containers","correct":false},{"text":"Clean utensils","correct":false},{"text":"Shared fryers","correct":true},{"text":"Storage shelves","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000202', 3, 'Why are shared fryers considered high-risk?',
   '[{"text":"They cook too quickly","correct":false},{"text":"They increase food cost","correct":false},{"text":"Allergen proteins can transfer through shared oil","correct":true},{"text":"They affect food temperature","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000202', 4, 'What should staff use when preparing allergy orders?',
   '[{"text":"Dirty utensils","correct":false},{"text":"Shared cutting boards without cleaning","correct":false},{"text":"Clean and sanitized tools and surfaces","correct":true},{"text":"Guesswork","correct":false}]'::jsonb, 2),
  -- Lesson 2.3 (4)
  ('d1000000-0000-0000-0000-000000000203', 1, 'Do gloves alone prevent allergen cross-contact?',
   '[{"text":"Yes","correct":false},{"text":"Sometimes","correct":false},{"text":"No, gloves alone do not prevent cross-contact","correct":true},{"text":"Only during prep","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000203', 2, 'When should staff wash their hands?',
   '[{"text":"Only at the beginning of a shift","correct":false},{"text":"Only after handling raw meat","correct":false},{"text":"Before changing gloves and after touching allergens","correct":true},{"text":"Only after breaks","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000203', 3, 'Can gloves spread allergens?',
   '[{"text":"No","correct":false},{"text":"Only damaged gloves","correct":false},{"text":"Yes, gloves can transfer allergens between foods and surfaces","correct":true},{"text":"Only plastic gloves","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000203', 4, 'What should staff do after touching allergen-containing food?',
   '[{"text":"Continue working normally","correct":false},{"text":"Wipe gloves quickly","correct":false},{"text":"Wash hands and change gloves before handling another dish","correct":true},{"text":"Ignore the risk","correct":false}]'::jsonb, 2),
  -- Lesson 2.4 (4)
  ('d1000000-0000-0000-0000-000000000204', 1, 'What should staff do before preparing an allergy-sensitive meal?',
   '[{"text":"Begin cooking immediately","correct":false},{"text":"Ignore nearby foods","correct":false},{"text":"Use clean prep surfaces and verify ingredients","correct":true},{"text":"Reuse utensils","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000204', 2, 'Why should allergy orders be kept separate from other foods?',
   '[{"text":"To improve appearance","correct":false},{"text":"To speed up cooking","correct":false},{"text":"To reduce the risk of cross-contact","correct":true},{"text":"To reduce cost","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000204', 3, 'What should staff do if they are unsure whether a dish is safe?',
   '[{"text":"Guess based on experience","correct":false},{"text":"Serve it anyway","correct":false},{"text":"Stop and verify ingredients or ask a manager","correct":true},{"text":"Ignore the concern","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000204', 4, 'What is one benefit of using separate prep areas when possible?',
   '[{"text":"Faster cooking","correct":false},{"text":"Lower food cost","correct":false},{"text":"Reduced allergen exposure and cross-contact risk","correct":true},{"text":"Larger menu options","correct":false}]'::jsonb, 2),
  -- Lesson 3.1 (4)
  ('d1000000-0000-0000-0000-000000000301', 1, 'What should staff do when a guest reports a food allergy?',
   '[{"text":"Ignore the concern","correct":false},{"text":"Assume it is minor","correct":false},{"text":"Take the allergy seriously and communicate it clearly","correct":true},{"text":"Continue service without changes","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000301', 2, 'Which of the following is an appropriate response to a guest with a food allergy?',
   '[{"text":"“You’ll probably be fine.”","correct":false},{"text":"“Just remove the ingredient.”","correct":false},{"text":"“Let me confirm the ingredients and preparation process for you.”","correct":true},{"text":"“We never have issues here.”","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000301', 3, 'When should staff escalate an allergy concern?',
   '[{"text":"Never","correct":false},{"text":"Only during busy shifts","correct":false},{"text":"When there is uncertainty about ingredients or preparation","correct":true},{"text":"Only if the guest requests it","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000301', 4, 'Why is clear communication important when handling allergy disclosures?',
   '[{"text":"It improves food presentation","correct":false},{"text":"It reduces menu size","correct":false},{"text":"It helps reduce risk and prevent misunderstandings","correct":true},{"text":"It speeds up cooking","correct":false}]'::jsonb, 2),
  -- Lesson 3.2 (4)
  ('d1000000-0000-0000-0000-000000000302', 1, 'What is the purpose of the AllergenWise Risk Reduction Workflow?',
   '[{"text":"Increase menu options","correct":false},{"text":"Speed up service","correct":false},{"text":"Reduce allergen risk through structured communication and procedures","correct":true},{"text":"Reduce staffing needs","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000302', 2, 'Why should allergy alerts be entered clearly into the POS/KDS system?',
   '[{"text":"To improve presentation","correct":false},{"text":"To reduce food cost","correct":false},{"text":"To ensure the kitchen recognizes the allergy and follows precautions","correct":true},{"text":"To simplify menus","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000302', 3, 'Should staff assume the kitchen saw the allergy note during a busy shift?',
   '[{"text":"Yes","correct":false},{"text":"Only during slow hours","correct":false},{"text":"No, verbal confirmation may also be necessary","correct":true},{"text":"Only for severe allergies","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000302', 4, 'Which of the following is part of the AllergenWise workflow?',
   '[{"text":"Ignoring modifications","correct":false},{"text":"Guessing ingredients","correct":false},{"text":"Verifying ingredients and preparation methods","correct":true},{"text":"Removing communication steps","correct":false}]'::jsonb, 2),
  -- Lesson 3.3 (4)
  ('d1000000-0000-0000-0000-000000000303', 1, 'Can a restaurant guarantee a completely allergen-free environment?',
   '[{"text":"Yes","correct":false},{"text":"Only with trained staff","correct":false},{"text":"No, restaurants cannot guarantee a completely allergen-free environment","correct":true},{"text":"Only during slow hours","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000303', 2, 'Which statement is appropriate when speaking with a guest about allergies?',
   '[{"text":"“There is no risk.”","correct":false},{"text":"“You’ll definitely be safe.”","correct":false},{"text":"“We take allergies seriously and will take precautions.”","correct":true},{"text":"“You should be fine.”","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000303', 3, 'What should staff do if a dish cannot be safely prepared?',
   '[{"text":"Serve it anyway","correct":false},{"text":"Ignore the concern","correct":false},{"text":"Inform the guest honestly and escalate when needed","correct":true},{"text":"Guess based on experience","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000303', 4, 'Why is honest communication important?',
   '[{"text":"It speeds up service","correct":false},{"text":"It reduces menu options","correct":false},{"text":"It helps manage expectations and reduce risk","correct":true},{"text":"It improves food presentation","correct":false}]'::jsonb, 2),
  -- Lesson 3.4 (4)
  ('d1000000-0000-0000-0000-000000000304', 1, 'Which of the following may be a sign of a severe allergic reaction?',
   '[{"text":"Mild hunger","correct":false},{"text":"Fatigue","correct":false},{"text":"Difficulty breathing or throat swelling","correct":true},{"text":"Tiredness","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000304', 2, 'What should staff do if a severe allergic reaction is suspected?',
   '[{"text":"Wait to see if symptoms improve","correct":false},{"text":"Ignore the concern","correct":false},{"text":"Alert a manager and call 911 immediately","correct":true},{"text":"Continue normal service","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000304', 3, 'Should allergic reactions always be taken seriously?',
   '[{"text":"No","correct":false},{"text":"Only if severe","correct":false},{"text":"Yes, all reactions should be taken seriously","correct":true},{"text":"Only during busy shifts","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000304', 4, 'What should staff do after calling for emergency help?',
   '[{"text":"Leave the guest alone","correct":false},{"text":"Return to work","correct":false},{"text":"Stay with the guest and monitor their condition","correct":true},{"text":"Ignore the situation","correct":false}]'::jsonb, 2),
  -- Lesson 4.1 (4)
  ('d1000000-0000-0000-0000-000000000401', 1, 'Why should ingredients always be verified before preparing an allergy-sensitive meal?',
   '[{"text":"To improve presentation","correct":false},{"text":"To reduce food cost","correct":false},{"text":"Hidden allergens may exist in sauces, marinades, and prepared foods","correct":true},{"text":"To speed up service","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000401', 2, 'Which of the following may contain hidden allergens?',
   '[{"text":"Water","correct":false},{"text":"Ice","correct":false},{"text":"Sauces and spice blends","correct":true},{"text":"Plain napkins","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000401', 3, 'What should staff do if they are unsure whether an ingredient contains an allergen?',
   '[{"text":"Guess based on experience","correct":false},{"text":"Continue preparing the dish","correct":false},{"text":"Stop and verify the ingredient before serving","correct":true},{"text":"Ignore the concern","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000401', 4, 'If ingredients cannot be verified safely, what may be the safest option?',
   '[{"text":"Serve the dish anyway","correct":false},{"text":"Ignore the concern","correct":false},{"text":"Avoid serving the dish","correct":true},{"text":"Reduce portion size","correct":false}]'::jsonb, 2),
  -- Lesson 4.2 (4)
  ('d1000000-0000-0000-0000-000000000402', 1, 'What should staff do before preparing an allergy-sensitive meal?',
   '[{"text":"Begin cooking immediately","correct":false},{"text":"Reuse dirty utensils","correct":false},{"text":"Prepare a clean workspace and identify the allergy clearly","correct":true},{"text":"Ignore nearby foods","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000402', 2, 'Why should allergy orders be kept separate from other foods?',
   '[{"text":"To improve presentation","correct":false},{"text":"To increase menu options","correct":false},{"text":"To reduce the risk of cross-contact","correct":true},{"text":"To reduce cleaning time","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000402', 3, 'Which kitchen equipment is considered high-risk for allergen exposure?',
   '[{"text":"Sealed containers","correct":false},{"text":"Storage shelves","correct":false},{"text":"Shared fryers and grills","correct":true},{"text":"Ice bins","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000402', 4, 'Can small mistakes during preparation create allergen risk?',
   '[{"text":"No","correct":false},{"text":"Only during busy shifts","correct":false},{"text":"Yes, even small mistakes can create risk","correct":true},{"text":"Only with shellfish","correct":false}]'::jsonb, 2),
  -- Lesson 4.3 (4)
  ('d1000000-0000-0000-0000-000000000403', 1, 'What is the purpose of final verification before service?',
   '[{"text":"Improve food presentation","correct":false},{"text":"Speed up service","correct":false},{"text":"Confirm the dish was prepared safely and correctly","correct":true},{"text":"Reduce food cost","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000403', 2, 'What should staff check before serving an allergy-sensitive dish?',
   '[{"text":"Portion size only","correct":false},{"text":"Table decorations","correct":false},{"text":"Ingredients, modifications, and possible allergen exposure","correct":true},{"text":"Music volume","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000403', 3, 'Should the final verification process be rushed?',
   '[{"text":"Yes","correct":false},{"text":"Only during busy hours","correct":false},{"text":"No, final verification should never be rushed","correct":true},{"text":"Only for large tables","correct":false}]'::jsonb, 2),
  ('d1000000-0000-0000-0000-000000000403', 4, 'Why is visual inspection important before serving?',
   '[{"text":"It improves presentation","correct":false},{"text":"It reduces cleaning time","correct":false},{"text":"It may help identify incorrect ingredients or garnishes","correct":true},{"text":"It speeds up delivery","correct":false}]'::jsonb, 2),
  -- Lessons 5.1–5.6 — outline only in source → single missing-content marker row each.
  ('d1000000-0000-0000-0000-000000000501', 1, '<!-- CONTENT MISSING — not provided in source file -->', '[]'::jsonb, NULL),
  ('d1000000-0000-0000-0000-000000000502', 1, '<!-- CONTENT MISSING — not provided in source file -->', '[]'::jsonb, NULL),
  ('d1000000-0000-0000-0000-000000000503', 1, '<!-- CONTENT MISSING — not provided in source file -->', '[]'::jsonb, NULL),
  ('d1000000-0000-0000-0000-000000000504', 1, '<!-- CONTENT MISSING — not provided in source file -->', '[]'::jsonb, NULL),
  ('d1000000-0000-0000-0000-000000000505', 1, '<!-- CONTENT MISSING — not provided in source file -->', '[]'::jsonb, NULL),
  ('d1000000-0000-0000-0000-000000000506', 1, '<!-- CONTENT MISSING — not provided in source file -->', '[]'::jsonb, NULL)
;

-- Clear this seed's existing checkpoint questions for the 5 sections so a
-- re-seed is clean (question_choices cascades on delete). Only lesson-tagged
-- rows are this block's; the exam pool (lesson_id NULL) is untouched here.
delete from questions q
 using lessons l
 where q.lesson_id = l.id
   and l.module_id in (
     'c1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002',
     'c1000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000004',
     'c1000000-0000-0000-0000-000000000005');

-- One questions row per staged question (skip the outline-only marker rows,
-- which carry an empty options array). module_id is resolved from the lesson.
insert into questions (id, prompt, lesson_id, module_id, difficulty, is_exam_eligible)
select
  md5('quiz:' || sq.lesson_id::text || ':' || sq.order_index)::uuid,
  sq.question,
  sq.lesson_id,
  l.module_id,
  'medium',
  false
from _seed_quiz sq
join lessons l on l.id = sq.lesson_id
where jsonb_array_length(sq.options) > 0;

-- One question_choices row per option; is_correct from the option's `correct`
-- flag; order_index = 0-based array ordinality. The canonical answer key lives
-- here (server-side scoring reads it; the app never sends is_correct to clients).
insert into question_choices (id, question_id, text, is_correct, order_index)
select
  md5('quizchoice:' || sq.lesson_id::text || ':' || sq.order_index || ':' || (t.ord - 1))::uuid,
  md5('quiz:' || sq.lesson_id::text || ':' || sq.order_index)::uuid,
  t.elem->>'text',
  coalesce((t.elem->>'correct')::boolean, false),
  (t.ord - 1)::int
from _seed_quiz sq
cross join lateral jsonb_array_elements(sq.options) with ordinality as t(elem, ord)
where jsonb_array_length(sq.options) > 0;

commit;

-- ─── Final Certification Test pool ───────────────────────────────────────────
-- The Final exam draws from the shared bank where is_exam_eligible=true
-- (lesson_id NULL = exam-only). The source file provides NO exam pool, so none
-- is seeded; /api/exam/start returns "Final exam not yet available — content
-- pending" while fewer than 25 exam-eligible questions exist.
--
-- Clear any placeholder exam pool a previous scaffold may have seeded for the 5
-- sections so re-running this file leaves the pool empty. Safe no-op on a fresh
-- DB. (Lesson checkpoint questions are is_exam_eligible=false and untouched.)
delete from questions
 where is_exam_eligible = true
   and module_id in (
     'c1000000-0000-0000-0000-000000000001',
     'c1000000-0000-0000-0000-000000000002',
     'c1000000-0000-0000-0000-000000000003',
     'c1000000-0000-0000-0000-000000000004',
     'c1000000-0000-0000-0000-000000000005'
   );
