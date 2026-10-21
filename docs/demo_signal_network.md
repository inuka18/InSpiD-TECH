# Demo: messages that change the requirement network (SYS-RET)

Written for: someone running the live demo (a PM of the Online Retail Platform, `SYS-RET`) who wants to show that communication signals change the requirement network and the alignment score.

Seven messages, submitted in order, change the network five times. Three of them name requirement ids, two rely on inferred co-reference, one is a profile-only message that changes nothing, and one is a control that changes nothing. Nothing was tuned to make this work (see "How these were chosen").

## Before you start

- Log in as the PM of SYS-RET (`pm.ret@inspid.test`) and open **Requirements → Signal Feed**. Start from the state in **Demo reset** below, so the numbers match.
- Submit each message with **Submit a message** (source Slack is fine). The **Network Map** strip at the top of the map shows `Alignment n%`; reload the page, or switch tabs, after each message.
- **Three messages stay "Pending review" and need your Accept.** Messages that contain requirement ids score low in the classifier (it has never seen ids in its training data) and the id text also lowers the match similarity, so the review policy sends them to a PM. They change the network **when you accept them** (Signal Feed → *Pending review* → **Accept**), because accepting is what applies a signal. The other four are applied automatically.
- Watch the **Traceability Ledger**: each change shows as one *Network Updated* entry triggered by the signal that caused it.

## The messages and what happened

Run on the local test database `inspid_test` (never on Atlas) on 2026-10-21, with the real ai-service and its active classifier (auto-accept threshold 90, matching floor 0.40). Initial state: baseline **Initial baseline**, 30 computed links, alignment **100% (Strong Alignment)**. "Alignment after" is read from `GET /alignment` after each message (and after the Accept where one was needed).

| # | Kind | Message (submit exactly this) | Label (confidence) | Matched requirement (top 3 similarities) | How it was applied | Links added | Links removed | Changed the network? | Alignment after |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Names two ids | `RET-R12 must stay in sync with RET-R14, so gift cards can be added to the wishlist.` | Constraint (83) | RET-R14 (R14 0.47, R12 0.39, R10 0.28) | Pending (low confidence), **PM accepted** | RET-R12 ↔ RET-R14 | RET-R12 ↔ RET-R22 | **Yes** | **94%** Strong |
| 2 | Inferred co-reference | `Customers want the order tracking page to show the status of their returns and refunds.` | Expectation (99) | RET-R05 (R05 0.74, R10 0.71, R23 0.53) | Auto-applied | RET-R05 ↔ RET-R10 | RET-R10 ↔ RET-R24 | **Yes** | **88%** Strong |
| 3 | Names two ids | `RET-R03 and RET-R14 must be delivered together, because gift card balances have to persist in the cart.` | Constraint (88) | RET-R14 (R14 0.47, R10 0.36, R04 0.33) | Pending (low confidence), **PM accepted** | RET-R03 ↔ RET-R14 | RET-R03 ↔ RET-R12 | **Yes** | **82%** Strong |
| 4 | Profile only | `Stock reserved at checkout must be released when a return is approved for the same order.` | Constraint (100) | RET-R17 (R17 0.62, R10 0.43, R15 0.41) | Auto-applied | none | none | **No** | 82% Strong |
| 5 | Inferred co-reference | `Order notifications must respect the privacy and consent settings of the customer.` | Constraint (96) | RET-R24 (R24 0.60, R29 0.53, R25 0.40) | Auto-applied | RET-R24 ↔ RET-R29 | RET-R10 ↔ RET-R29 | **Yes** | **76%** Moderate Drift |
| 6 | Names two ids | `The refund flow RET-R10 must be built on top of the stock reservation RET-R17.` | Constraint (86) | RET-R10 (R10 0.38, R17 0.36, R09 0.20) | Pending (low confidence), **PM accepted** | RET-R10 ↔ RET-R17 | RET-R05 ↔ RET-R17 | **Yes** | **71%** Moderate Drift |
| 7 | Control | `Reminder: the team lunch is on Friday at 1 pm, please confirm if you are coming.` | None (100) | none | Accepted, no effect | none | none | **No** | 71% Moderate Drift |

Afterwards the ledger chain verifies (`GET /ledger/verify` valid), there are exactly five new *Network Updated* entries (one per message that changed the network) and no entry for messages 4 and 7. Signal ids in this run were SC-2299 to SC-2305. A rerun after a full reset (see below) gave identical results.

What each kind does:

- **Names two ids (1, 3, 6):** each message gives one *id-mention* evidence row for the named pair, worth +0.15 on that pair's similarity. Messages 1 and 3 name the pair directly. Message 6 names RET-R10 and RET-R17 (the signal itself is matched to RET-R10).
- **Inferred co-reference (2, 5):** the matcher found the two requirements about equally similar (message 2: R05 0.74 and R10 0.71; message 5: R24 0.60 and R29 0.53; both within 0.10 and above 0.40), so one *co-reference* row is written for that pair, worth +0.06. That was enough here only because those pairs were already almost linked (their text similarity was within about 0.01 of the Pathfinder threshold). It would not connect a pair that is far from linked.
- **Profile only (4):** the message was applied to RET-R17, which updates its signal profile (count 1), but a profile only affects a link once *both* requirements have one, and its weight grows with the smaller count (full weight at 10 signals), so one message cannot change anything. This is expected, and shows that profiles are a slow, cumulative effect.
- **Every change that adds a link also removes one.** Pathfinder keeps the smallest set of links that connect the strongest paths, so a stronger pair can make a neighbouring link redundant. Each message that changes the network therefore moves the alignment down by about 5 to 6 points here (one link added, one removed: the Jaccard score on 30 links).

### What to point at while demoing

1. **Network Map:** the strip at the top (`Alignment 94% (Strong Alignment)` after message 1). Click the new link RET-R12 ↔ RET-R14: *Where this link comes from* shows the text part and the evidence part, and *Signal evidence* lists SC-2299.
2. **Alignment Score page:** current score, band, the day's changes and the driving signal (the page names the signal behind the day's largest change).
3. **Traceability Ledger:** the *Network Updated* entries, each triggered by one signal, and the *Baseline Created* entry for the initial baseline.
4. **Freeze new baseline** (PM, top of the map): freezes the current network; alignment returns to 100% against the new baseline.

## How these were chosen (read this)

- The messages were written for the SYS-RET requirement list and then **screened with `POST /signals/preview`** (which saves nothing) to find phrasings that the classifier labels confidently and that match the intended requirements. For the id messages the target pairs were picked from the pairs that Pathfinder had *not* linked but that were close to the threshold, so that the evidence could matter. That is selecting messages, not tuning the system.
- **The constants were not changed** at any point, before or after seeing results (`backend/src/modules/network/constants.js`). If fewer messages had worked, this document would say so.
- Honest limits: five of seven messages changed the network here, but only because the pairs were chosen to sit near the threshold. A message about two unrelated requirements would not link them (the boosts are capped at 0.35). Pending messages with ids need a PM, so they are not "hands-free" signals. On the scenario data, feeding signals into the network made no clear difference to agreement with the answer key (`docs/network_evaluation.md`, section 6); this demo shows that the mechanism works and is auditable, not that the resulting links are better.

## Demo reset: return to the starting state

Do this on Atlas before every demo run. It deletes **all** data in the `inspid` database (users, projects, signals, ledger, baselines), so only do it on the demo database.

1. **Drop the database.** In the Atlas web UI: *Browse Collections* → database `inspid` → **Drop Database** (or `mongosh "<your Atlas connection string>" --eval 'db.getSiblingDB("inspid").dropDatabase()'`; keep the connection string out of the repo and your shell history).
2. **Restart the backend** so it recreates its indexes (including the unique initial-baseline index): `docker compose restart backend`.
3. **Seed:** `docker compose exec backend npm run seed`.
4. **Build the network and the initial baselines:** `docker compose exec backend npm run network:build`.
5. **Check:** `GET /api/v1/projects/SYS-RET/ledger/verify` says `valid: true`, and the Network Map shows the strip below.

What you should see afterwards, for **SYS-RET** (the other projects are similar; numbers are from the reference run, and the block numbers depend only on the seed data):

- 31 requirements, **30 computed links**, 6 clusters; `network:build` prints `+30 / -0, ledger block 354` and `initial baseline BL-… (30 links, ledger block 355)`.
- Exactly one baseline, **Initial baseline**, frozen at the time of `network:build`. Network Map strip: `Baseline: Initial baseline, frozen <today> | Alignment 100% (Strong Alignment)`.
- Alignment page: 100%, Strong Alignment, one history point, no driving signal.
- Ledger: 355 entries, the last two being *Network Updated* (the first computation, 30 links added) and *Baseline Created* (Initial baseline), both by `system` / `network:build`.
- 12 pending seeded signals are left for the Accept/Reject demo. Do not mix them up with the new messages: the seeded ones are dataset rows and never change the network.

The same four steps on the local test database (never Atlas): `docker exec inspid-mongo-1 mongosh inspid_test --eval "db.dropDatabase()"`, `docker compose restart backend-test-api`, then `docker compose --profile localdb --profile test run --rm backend-test npm run seed` and `... npm run network:build`.

Note that `npm run rechain` refuses once `NETWORK_UPDATE` or `BASELINE_CREATED` entries exist; after a reset there is nothing to rechain on a fresh seed.
