# Data pack: Living Requirements Engine (Component 1)

Run all commands from this folder. Needs Python 3 with `pandas` and `openpyxl`.

    pip install pandas openpyxl
    python scripts/prepare_jira.py
    python scripts/prepare_requirements.py

IMPORTANT when reading scenario files with pandas: the label "None" is text, not missing.

    pd.read_csv("data/scenario/scenario_signals.csv", keep_default_na=False)

## data/processed/jira_cleaned.csv  (18,683 rows)
Public Jira texts after removing commit messages, stack traces, very short texts and duplicates.
| column | meaning |
|---|---|
| text_id | unique id, JT-00001 onward |
| collection | which Jira instance: Jira, MongoDB, RedHat, Spring |
| issue_key | original issue key |
| issue_type | Bug, Task, Improvement or Story |
| text_source | where in the issue the text came from: description or comment |
| text | cleaned text |
| char_len | number of characters in text |
| weak_label | keyword-rule guess (Constraint, Expectation, Completion, Conflict); blank if no rule or several rules matched. Rough, review before training |
| label | empty, fill after manual review |

## data/processed/requirement_bank.csv  (5,995 rows)
| column | meaning |
|---|---|
| req_bank_id | unique id, RB-00001 onward |
| text | requirement sentence |
| type | FR (functional), NFR (non-functional), or blank |
| needs_type_review | 1 when type is blank |
| char_len | number of characters in text |

## data/scenario/
Four systems: Online Retail Platform, Hospital Management System, Mobile Banking App, University Learning Portal.

### scenario_projects.csv  (4 rows)
project_id, name, domain, description.

### scenario_requirements.csv  (114 rows)
| column | meaning |
|---|---|
| req_id | requirement id, e.g. RET-R01 |
| project_id | system the requirement belongs to |
| project_name | system name |
| title | short requirement title |
| description | one-sentence description |
| type | FR or NFR |
| group_id | theme group; requirements in one group belong together (used for network testing) |
| granularity | Sprint Commitment or Weekly Workload |
| initial_status | status before any message (always Confirmed) |
| final_status | status after all messages are applied |
| split | train, val or test (assigned per requirement) |

### scenario_signals.csv  (2,298 rows)
| column | meaning |
|---|---|
| signal_id | unique id, SC-0001 onward, in time order |
| project_id | system the message belongs to |
| source | Standup, Slack, Email, Teams or Jira Comment |
| author_role | role of the sender (no names) |
| timestamp | ISO date-time, +05:30 |
| text | message text |
| label | Constraint, Expectation, Completion, Conflict or None |
| req_id | requirement the message refers to; blank for general chatter |
| resulting_status | requirement status after this message; blank when req_id is blank |
| split | train, val or test (by requirement, so no requirement is in two splits) |
| batch | A or B, a grouping of the rows |

### scenario_status_history.csv  (2,138 rows)
One row per message that refers to a requirement. Use it to seed the ledger and to test the status engine.
| column | meaning |
|---|---|
| history_id | unique id, SH-0001 onward |
| project_id, req_id | system and requirement |
| signal_id | the message that caused this row |
| timestamp | same as the message |
| label | class of the message |
| from_status, to_status | requirement status before and after |
| status_changed | 1 if the status changed, otherwise 0 |
| source, author_role | copied from the message |

### scenario_related_pairs.csv  (232 rows)
Requirement pairs that belong together: relation_type is same_group or dependency. Pairs not listed are treated as unrelated.

## Status rules
Expectation -> Confirmed, Constraint -> Modified, Conflict -> At Risk (Dropped when the message removes the requirement from scope), Completion -> Confirmed, None -> no change.
