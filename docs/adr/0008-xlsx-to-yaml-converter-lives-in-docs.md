# ADR-0008: The workbook converter lives in docs/checklists and is Python

Status: accepted. Date: 2026-09-16.

The checklist workbook is the planning artifact and is edited outside the app.
Turning it into seed YAML is a documentation task, not a runtime one, so the
converter (`docs/checklists/xlsx_to_yaml.py`, openpyxl + PyYAML) sits with the
checklist documentation rather than in the Rails app, avoiding a spreadsheet
gem in the API bundle. The generated YAML in `api/db/seeds/checklists/` is
committed and is what the API seeds from.
