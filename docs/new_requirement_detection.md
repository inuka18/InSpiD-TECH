# New-requirement detection: evaluation

Generated 2026-10-22T08:46:17.923Z on database `inspid_test`. Splits run: dev, test.

## 1. Detection on new_requirement_test.csv

Real classifier and matcher. A row is predicted "new requirement" when the detector flags it (Expectation, confidence >= 70, novel).

| Split | Rule set | Rows | TP | FP | FN | TN | Precision | Recall | F1 |
|---|---|---|---|---|---|---|---|---|---|
| dev | with novel-token rule (a)+(b) | 28 | 13 | 0 | 3 | 12 | 100.0% | 81.3% | 0.897 |
| dev | without it (only (a)) | 28 | 1 | 0 | 15 | 12 | 100.0% | 6.3% | 0.118 |
| test | with novel-token rule (a)+(b) | 32 | 10 | 0 | 6 | 16 | 100.0% | 62.5% | 0.769 |
| test | without it (only (a)) | 32 | 0 | 0 | 16 | 16 | - | 0.0% | - |

### Wrong decisions (with the novel-token rule)

| id | split | kind | label | conf | top sim | closest | novel tokens | text |
|---|---|---|---|---|---|---|---|---|
| NR-021 | test | missed (FN) | Expectation | 100 | 0.587 | HMS-R01 | copy, medical, records | Patients should be able to request a copy of their medical records online. |
| NR-045 | test | missed (FN) | Expectation | 72 | 0.550 | HMS-R13 | transcribe, voice | Doctors are hoping the system can transcribe their consultation notes from voice. |
| NR-007 | test | missed (FN) | Expectation | 39 | 0.406 | MBA-R07 | - | Update from me: Business customers need to approve payments with two signatories. |
| NR-028 | dev | missed (FN) | Expectation | 95 | 0.584 | RET-R21 | shoppers, uploading, photo | Heads up: Marketing is hoping shoppers can search for products by uploading a photo. |
| NR-039 | dev | missed (FN) | Expectation | 99 | 0.512 | RET-R24 | help, talk, chatbot | It would help if customers could talk to a chatbot to ask about their orders. |
| NR-003 | test | missed (FN) | Expectation | 56 | 0.392 | ULP-R01 | - | The registrar wants an alumni mentoring directory linked to the portal. |
| NR-026 | dev | missed (FN) | Expectation | 69 | 0.612 | ULP-R16 | - | Hi team. Parents of scholarship students would like read-only access to progress reports. Thanks. |
| NR-032 | test | missed (FN) | Expectation | 81 | 0.531 | ULP-R18 | polls | Update from me: Lecturers hope to run live polls during lectures from the portal. |
| NR-043 | test | missed (FN) | Expectation | 51 | 0.478 | ULP-R13 | - | Hello all. Lecturers are hoping for automatic captions on every lecture recording. Regards. |

### Wrong decisions (only rule (a))

| id | split | kind | label | conf | top sim | closest | novel tokens | text |
|---|---|---|---|---|---|---|---|---|
| NR-016 | dev | missed (FN) | Expectation | 95 | 0.486 | HMS-R14 | sisters, visitor, visits | The ward sisters would like a visitor management feature to record who visits which patient. |
| NR-021 | test | missed (FN) | Expectation | 100 | 0.587 | HMS-R01 | copy, medical, records | Patients should be able to request a copy of their medical records online. |
| NR-040 | dev | missed (FN) | Expectation | 94 | 0.453 | HMS-R09 | administrators, member, professional, expire | Administrators want a reminder when a staff member's professional registration is about to expire. |
| NR-045 | test | missed (FN) | Expectation | 72 | 0.550 | HMS-R13 | transcribe, voice | Doctors are hoping the system can transcribe their consultation notes from voice. |
| NR-048 | test | missed (FN) | Expectation | 92 | 0.451 | HMS-R03 | ambulance, dispatch, tracking, arrivals | Updating the ticket: The hospital wants an ambulance dispatch and tracking screen for emergency arrivals. |
| NR-058 | dev | missed (FN) | Expectation | 83 | 0.432 | HMS-R02 | kitchen, diet, meal, ordering, inpatients | Update from me: The kitchen team needs a diet and meal ordering feature for inpatients. |
| NR-060 | test | missed (FN) | Expectation | 98 | 0.468 | HMS-R18 | satisfaction, survey, sent | Management expects a patient satisfaction survey to be sent after every discharge. |
| NR-007 | test | missed (FN) | Expectation | 39 | 0.406 | MBA-R07 | - | Update from me: Business customers need to approve payments with two signatories. |
| NR-009 | test | missed (FN) | Expectation | 91 | 0.364 | MBA-R12 | whether, joint, family, member | Heads up: Customers keep asking whether they can set up a joint account with a family member. |
| NR-010 | test | missed (FN) | Expectation | 94 | 0.420 | MBA-R17 | voice, assistant, balances, speaking | Hello all. The bank would like a voice assistant so customers can check balances by speaking. Regards. |
| NR-035 | dev | missed (FN) | Expectation | 85 | 0.478 | MBA-R19 | offer, travel, insurance, point, purchase | From today's call: Marketing is hoping the app can offer travel insurance at the point of a card purchase. |
| NR-047 | dev | missed (FN) | Expectation | 100 | 0.414 | MBA-R33 | donate, charities, directly | Updating the ticket: Customers want to donate to registered charities directly from the app. |
| NR-052 | dev | missed (FN) | Expectation | 99 | 0.390 | MBA-R08 | split, restaurant, friends | Customers are asking for a way to split a restaurant bill with friends inside the app. |
| NR-054 | dev | missed (FN) | Expectation | 100 | 0.491 | MBA-R08 | sell, shares | Product wants customers to be able to buy and sell shares from the app. |
| NR-056 | test | missed (FN) | Expectation | 100 | 0.435 | MBA-R08 | wealth, advisers, book, financial, adviser | For standup: Wealth advisers would like customers to book a call with a financial adviser from the app. |
| NR-001 | dev | missed (FN) | Expectation | 99 | 0.409 | RET-R17 | loyalty, points, programme, earn | For standup: The business wants a loyalty points programme where customers earn points on every order. |
| NR-011 | test | missed (FN) | Expectation | 94 | 0.416 | RET-R14 | offer, wrapping, selected | Updating the ticket: Sellers have asked for a way to offer gift wrapping on selected items. |
| NR-020 | test | missed (FN) | Expectation | 99 | 0.437 | RET-R11 | compare, side, buying | Heads up: Customers want to compare two or three products side by side before buying. |
| NR-022 | dev | missed (FN) | Expectation | 98 | 0.399 | RET-R22 | click, collect, partner, stores | Hi team. Operations would like a click and collect option from our partner stores. Thanks. |
| NR-027 | test | missed (FN) | Expectation | 93 | 0.391 | RET-R17 | instalments, through, koko | Customers keep asking if they can pay in instalments through Koko at checkout. |
| NR-028 | dev | missed (FN) | Expectation | 95 | 0.584 | RET-R21 | shoppers, uploading, photo | Heads up: Marketing is hoping shoppers can search for products by uploading a photo. |
| NR-039 | dev | missed (FN) | Expectation | 99 | 0.512 | RET-R24 | help, talk, chatbot | It would help if customers could talk to a chatbot to ask about their orders. |
| NR-050 | test | missed (FN) | Expectation | 99 | 0.393 | RET-R24 | invoice, emailed, automatically, purchase | For standup: Finance asked for an invoice PDF to be emailed automatically after every purchase. |
| NR-003 | test | missed (FN) | Expectation | 56 | 0.392 | ULP-R01 | - | The registrar wants an alumni mentoring directory linked to the portal. |
| NR-004 | test | missed (FN) | Expectation | 90 | 0.489 | ULP-R05 | peer, tutoring, marketplace, seniors, offer, sessions | Students are asking for a peer tutoring marketplace where seniors can offer help sessions. |
| NR-012 | dev | missed (FN) | Expectation | 96 | 0.453 | ULP-R02 | careers, apply, internships, through | The careers office wants students to upload CVs and apply for internships through the portal. |
| NR-014 | dev | missed (FN) | Expectation | 88 | 0.483 | ULP-R02 | faculty, research, project, allocation, tool, final, year | The faculty wants a research project allocation tool for final-year students. |
| NR-026 | dev | missed (FN) | Expectation | 69 | 0.612 | ULP-R16 | - | Hi team. Parents of scholarship students would like read-only access to progress reports. Thanks. |
| NR-032 | test | missed (FN) | Expectation | 81 | 0.531 | ULP-R18 | polls | Update from me: Lecturers hope to run live polls during lectures from the portal. |
| NR-043 | test | missed (FN) | Expectation | 51 | 0.478 | ULP-R13 | - | Hello all. Lecturers are hoping for automatic captions on every lecture recording. Regards. |
| NR-059 | dev | missed (FN) | Expectation | 88 | 0.401 | ULP-R09 | hostel, allocation, handled | Heads up: The hostel office wants room allocation requests handled in the portal. |

## 2. Specificity: scenario Expectation signals

Every scenario Expectation signal belongs to an existing requirement, so every flag is a false alarm. Replayed oldest first with the real classifier and matcher; "earlier signals" are the scenario signals before it.

| Scope | Expectations | Flagged (a)+(b) | Share | Flagged (a) only | Share |
|---|---|---|---|---|---|
| **all** | 583 | 47 | 8.1% | 7 | 1.2% |
| SYS-HMS | 136 | 8 | 5.9% | 0 | 0.0% |
| SYS-MBA | 175 | 12 | 6.9% | 3 | 1.7% |
| SYS-RET | 149 | 14 | 9.4% | 3 | 2.0% |
| SYS-ULP | 123 | 13 | 10.6% | 1 | 0.8% |
| split train | 385 | 26 | 6.8% | 2 | 0.5% |
| split val | 86 | 8 | 9.3% | 2 | 2.3% |
| split test | 112 | 13 | 11.6% | 3 | 2.7% |

## 3. Honest limits

- The test set is small (60 rows: 28 dev, 32 test) and was written by us, so the numbers are indicative, not a guarantee on real project chatter.
- The constants were fixed a priori and not tuned on the test rows. Nothing was tuned on dev either: dev precision 100% and recall 81% were not clearly poor, so every constant is still its a-priori default (tuning log in `backend/src/modules/signals/newRequirementConstants.js`: none).
- Constants used: NEW_REQ_MIN_CONFIDENCE=70, NEW_REQ_SIM_LOW=0.35, NEW_REQ_SIM_HIGH=0.5, NEW_REQ_NOVEL_MAX_SIGNALS=2.
