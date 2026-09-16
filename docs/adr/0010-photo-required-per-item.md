# ADR-0010: Photo required per checklist item, not universally

Status: accepted. Date: 2026-09-16. Amends spec 4.2 (updated in the same commit).

## Context

Spec 4.2 required a photo on every inspection item. Pilot run 1 showed that
is wrong for function tests whose finding is behavioural or audible: a photo
of a backup alarm's speaker grille, a neutral start switch or a PTO interlock
proves nothing about whether it worked. Forcing one produces meaningless
photos and slows the walk.

## Decision

Use the `photo_required` boolean that the template JSON schema (spec 4.3)
already carries, per item. Its source of truth is a new **Photo Required**
column in the PM checklist workbook, carried into the seed YAML by
`docs/checklists/xlsx_to_yaml.py` (blank means Yes). It is never derived
from `check_method`: one edge case later would force a derivation rule to
change for everything.

`No` is set only for behavioural / audible function tests: skid steer backup
alarm and exhaust carbon clear; loader foot pedals / joysticks; excavator
horn / travel alarm / warning devices, travel controls, heating and cooling;
dozer travel controls, heating and cooling; farm tractor PTO interlocks,
neutral start switch, PTO switch test, seat switch, brake pedals and park
brake, hydrostatic transmission engagement. Items with a visible outcome
(lights, seat belt, gauges, diagnostic display, shields) keep the photo.

The app's per-item completion check and the server's lock validation both
read the same flag. A carried-forward High recheck always needs a fresh
photo regardless of the flag (spec 6).

## Consequences

- The checklist content changed, so this ships as template version
  **alpha-2**; published templates are immutable. Machines set up on alpha-1
  keep it until `bin/rails uptime:templates:upgrade_machines` moves them to
  the highest published version; their past inspections keep alpha-1.
- Item keys are unchanged, so carried-forward rechecks and history line up
  across the version change.
- Lock validation messages now count the outstanding items and name them.
