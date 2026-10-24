# SRS import: evaluation

Run on `inspid_test` with the real ai-service (`node src/scripts/srsEvaluate.js`, numbers in `srs_import_evaluation.json`). The script deletes and recreates its own temporary projects `SYS-SRS1..3`.

## 1. Preview and confirm

| File | Mode | Found | FR / NFR | Pre-selected | Created | Ledger entries | Network | Initial baseline |
|---|---|---|---|---|---|---|---|---|
| SRS_Online_Retail_Platform_Sample.docx | template | 31 | 24 / 7 | 31 | 31 | 31 REQUIREMENT_CREATED, 1 NETWORK_UPDATE, 1 BASELINE_CREATED | 30 links, 6 clusters | yes |
| SRS_Hospital_Management_System_Sample.docx | template | 26 | 20 / 6 | 26 | 26 | 26, 1, 1 | 25 links, 5 clusters | yes |
| 0000 - cctns.pdf (public CCTNS FRS v1.0 draft) | rule-based | 118 | 17 / 101 | 110 | 115 (all items of the nine sections) | one per requirement, 1 NETWORK_UPDATE | 114 links, 8 clusters | yes |

- The empty template reads as `template` mode with 0 rows (its 4 placeholder rows are skipped).
- Timings (local Docker, MiniLM on CPU): confirm of 31 / 26 / 115 requirements took 3.6 s / 1.3 s / 7.2 s including the embeddings and the network; `GET /network` afterwards took 29 / 27 / 65 ms.
- CCTNS default selection is 110 of 118: 5 rows are unselected because they contain `<xx>` placeholders (System Availability), 3 because they are low confidence. One of the 110 is a false positive (see below).

## 2. Rule-based mode check

**Samples without tables** (introduction text, then one statement per line, with the two section headings):

| Sample | Known | Found | Recall | Wrongly kept | Missed | Type correct |
|---|---|---|---|---|---|---|
| Online Retail | 31 | 32 | 100% (31/31) | 1 | 0 | 31/31 |
| Hospital | 26 | 27 | 100% (26/26) | 1 | 0 | 26/26 |

The wrongly kept row in both is the acceptance sentence "The system is accepted when every Must requirement has passed its verification...". Everything was `medium` confidence.

**CCTNS FRS (PDF, expected 115):**

| Section | Expected | Found | Wrongly kept | Missed | Medium / low | With `<xx>` |
|---|---|---|---|---|---|---|
| Help Module | 2 | 2 | 0 | 0 | 2 / 0 | 0 |
| Support Module | 5 | 5 | 0 | 0 | 5 / 0 | 0 |
| Audit Module | 8 | 8 | 0 | 0 | 8 / 0 | 0 |
| Access Module | 10 | 10 | 0 | 0 | 10 / 0 | 0 |
| Ease of Use | 9 | 9 | 0 | 0 | 9 / 0 | 0 |
| Usability | 47 | 47 | 0 | 0 | 46 / 1 | 0 |
| System Availability | 5 | 5 | 0 | 0 | 5 / 0 | 5 |
| Performance and Scalability | 5 | 5 | 0 | 0 | 5 / 0 | 0 |
| System Functionality | 24 | 24 | 0 | 0 | 24 / 0 | 0 |
| **Total** | **115** | **118** | **3** | **0** | | |

Recall 115/115 = 100%, precision 115/118 = 97.5%. The 3 wrongly kept items are outside the nine sections: one introduction paragraph of section 3 ("Registration ... police shall take the complaint forward", medium) and two sentences of section 5 (low). The sub-heading "Registration" is glued to the front of that first one. FR/NFR from the headings: 17 FR / 101 NFR (section 4 is "Non-functional requirements"; the 24 System Functionality items come out by keyword rules).

## 3. Network of the 115 CCTNS requirements

- 115 nodes, 114 Pathfinder links, 8 clusters, one NETWORK_UPDATE entry, Initial baseline created. Server side nothing is slow (7.2 s for the import, 65 ms for `GET /network`).
- Clusters (computed from the texts, never from the feature area): the Usability items split into sensible groups (text and formats; navigation and links; opening times and splash screens; layout and consistency), Help + Support form one cluster, the availability items form one with "downtime". The biggest cluster has 65 nodes and mixes Audit, Access, System Functionality and Performance items; its label is generic ("system, must") because every statement says "The System must / should".
- The map layout (`lib/networkLayout.js`) puts a cluster's nodes on one ring whose radius grows with the member count. For a cluster of 65 this gives a ring of about 1270 px with about 31 overlapping node pairs (nodes 200 px wide), and about 4 overlapping pairs in clusters of 8 to 11. Whole map is roughly 8900 x 6900 px. This was computed from the layout formula, not measured in a browser.

## 4. Honest limits

- The rule-based mode is a set of regular expressions, not a model. It was developed while looking at the CCTNS text, so the 115/115 on that document is not an independent test; the next unseen SRS will do worse. The samples were written by us.
- A list item is kept whenever it sits under a heading that introduces a numbered list, so a numbered list of non-requirements under such a heading would be kept (low confidence only when it has no modal verb).
- Nothing was tuned with the evaluation data after seeing results other than the rules described above.
