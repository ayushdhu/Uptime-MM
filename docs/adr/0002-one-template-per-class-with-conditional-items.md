# ADR-0002: One template per machine class, with conditional items

Status: accepted. Date: 2026-09-16.

## Context

Spec 4.2 keys `checklist_templates` on (machine_class, drive_type, has_def,
version) with nullable drive_type / has_def meaning "applies to both", and the
wizard picks the highest published version matching the machine. The PM
checklist workbook, however, has one tab per class in which the variant
specific rows (tires vs tracks, DEF tank, Tier 3 only exhaust carbon clear) are
marked conditional rather than split into separate lists.

## Decision

Seed one template per class with `drive_type = NULL` and `has_def = NULL`, and
carry the condition on the item as `applies_when` (`drive_type`, `has_def`,
`emissions_tier`). `ChecklistTemplate#items_for(machine)` on the server and
`itemsForMachine()` in the app drop items that do not apply to the machine at
inspection start. The schema and selection logic still support fully variant
specific templates: a row with a specific `drive_type` / `has_def` at the same
version outranks the wildcard row, so a class can be split later without a
migration.

## Consequences

- Fewer templates to publish and keep aligned; the workbook stays the source.
- An inspection still stores the exact template id and version it ran against;
  items that were filtered out simply have no inspection_items row (they were
  never applicable, which is different from a skip).
- The workbook's cadence labels ("Monthly / 100 Hr", "3000 Hr", "Weekly
  (drain) / Monthly (replace)") are normalized to the spec's `weekly` /
  `monthly` and the original text is kept in `cadence_label`. MVP shows every
  item every visit as the spec directs, so the normalization has no effect on
  the walkthrough yet.
