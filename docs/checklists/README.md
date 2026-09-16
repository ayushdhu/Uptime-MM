# Checklist sources

The PM checklists live in the workbook at the repository root,
`uptime_pm_checklists_alpha1.xlsx` (one tab per machine class plus a Shared
Criteria tab). The YAML the API seeds from is generated from it:

```sh
pip install openpyxl pyyaml
python3 docs/checklists/xlsx_to_yaml.py uptime_pm_checklists_alpha1.xlsx api/db/seeds/checklists
```

This writes `api/db/seeds/checklists/_shared_criteria.yml` and one
`<machine_class>.yml` per tab. Rows whose Low / Medium / High text matches a
shared criteria row exactly are emitted as `criteria_ref: <key>`; the seeder
merges the shared text back in, so it is defined once and cannot drift.

Rules:

- A published template is immutable. To change checklist content, bump
  `version` in the YAML (or the workbook) and re-seed; the setup wizard picks
  the highest published version for new machines, existing machines keep the
  version they locked.
- Item keys are slugs of the component label. Do not regenerate a published
  version's YAML in a way that renames keys; keys are how carried-forward
  rechecks and history line up across visits.
- Extra fields beyond spec 4.3 (`cadence_label`, `check_method_label`,
  `walkthrough_group`, `applies_when`, `pass_fail_criteria`, `criteria_ref`)
  are descriptive and used by the app UI; see ADR-0002.
