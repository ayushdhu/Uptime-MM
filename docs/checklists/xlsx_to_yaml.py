#!/usr/bin/env python3
"""
Convert the Uptime PM checklist workbook into the YAML seed files used by
api/db/seeds/checklists/.

Usage:
    python3 docs/checklists/xlsx_to_yaml.py uptime_pm_checklists_alpha1.xlsx api/db/seeds/checklists

Rules:
  * The "Shared Criteria" tab becomes _shared_criteria.yml.
  * Each machine tab becomes <machine_class>.yml.
  * A row whose Low/Medium/High text matches a shared criteria row byte for
    byte is written as `criteria_ref: <key>` with no inline text, so the
    shared file is the single source of truth and the texts can never drift.
  * Item keys are slugs of the component label, de-duplicated per template.
    Once a YAML file is committed, keys are stable; re-running this script
    must not be used to silently rename keys of a published template
    (publish a new version instead).
"""
import re
import sys
import openpyxl
import yaml

MACHINE_TABS = {
    "Skid Steer": "skid_steer",
    "Wheel Loader": "wheel_loader",
    "Excavator": "excavator",
    "Dozer": "dozer",
    "Farm Tractor": "farm_tractor",
}

def slug(text):
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return s[:60].rstrip("_")

def norm(t):
    return re.sub(r"\s+", " ", (t or "")).strip()

def cadence_of(label):
    l = label.lower()
    if l.startswith("weekly"):
        return "weekly"
    return "monthly"  # Monthly, Monthly / 100 Hr, 3000 Hr: all belong to the in-depth PM

def check_method_of(label, result_type):
    l = label.lower()
    if "physical" in l or "tug" in l or "play check" in l or "play)" in l or "deflection" in l:
        return "physical"
    if "gauge" in l or "voltmeter" in l or "measure" in l:
        return "measurement"
    if "sight glass" in l or "dipstick" in l or "level" in l:
        return "fluid_level"
    if "function" in l or "test" in l or "run machine" in l or "engage" in l:
        return "function"
    if result_type == "measurement":
        return "measurement"
    return "visual"

def measurement_of(component, method, notes):
    c = component.lower()
    m = method.lower()
    if "psi" in m or "pressure" in c:
        return {"unit": "psi", "reference": None, "flow": "tire_refill_test"}
    if "voltmeter" in m or "batter" in c:
        return {"unit": "volts", "reference": 12.6, "reference_24v": 25.2, "flow": "battery"}
    if "track" in c and ("tension" in c or "tightness" in c):
        return {"unit": "mm_sag", "reference": None}
    if "diagnostic" in c:
        return {"unit": "code_count", "reference": 0}
    if "def" in c.split() or "def tank" in c:
        return {"unit": "percent", "reference": None}
    # fluid levels and reservoirs
    return {"unit": "level_percent", "reference": 100}

def applies_when(component, notes):
    c = component.lower()
    n = (notes or "").lower()
    cond = {}
    if "(wheeled" in c:
        cond["drive_type"] = "wheeled"
    elif c.startswith("tracks") or c.startswith("track ") or c.startswith("undercarriage: track") or "(tracked" in c:
        cond["drive_type"] = "tracked"
    if "def tank" in c:
        cond["has_def"] = True
    if "tier 3 or older" in c or "tier 4 machines with def/scr skip" in n:
        cond["emissions_tier"] = "tier_3"
    return cond or None

def load_shared(wb):
    ws = wb["Shared Criteria"]
    shared = {}
    for row in ws.iter_rows(min_row=4, values_only=True):
        key, applies, low, med, high = row[:5]
        if not key:
            continue
        shared[key] = {
            "applies_to": norm(applies),
            "low": norm(low),
            "medium": norm(med),
            "high": norm(high),
        }
    return shared

def match_shared(shared, low, med, high):
    for key, c in shared.items():
        if c["low"] == low and c["medium"] == med and c["high"] == high:
            return key
    return None

def convert_tab(wb, tab, machine_class, shared):
    ws = wb[tab]
    items = []
    seen = {}
    section = None
    header_seen = False
    for row in ws.iter_rows(values_only=True):
        cells = ["" if c is None else str(c) for c in row]
        if not any(cells):
            continue
        if cells[0] == "Component" and cells[1] == "Section":
            header_seen = True
            continue
        if not header_seen:
            continue
        component, sect, cad, method, rtype, low, med, high, default, notes = (cells + [""] * 10)[:10]
        if component and not sect and not rtype:
            section = norm(component)  # section header row
            continue
        component, low, med, high = norm(component), norm(low), norm(med), norm(high)
        key = slug(component)
        if key in seen:
            seen[key] += 1
            key = f"{key}_{seen[key]}"
        else:
            seen[key] = 1
        rtype = rtype.strip()
        item = {
            "key": key,
            "component": component,
            "section": norm(sect) or section,
            "walkthrough_group": section,
            "cadence": cadence_of(cad),
            "cadence_label": norm(cad),
            "check_method": check_method_of(method, rtype),
            "check_method_label": norm(method),
            "result_type": rtype,
            "photo_required": True,
            "default_if_ambiguous": "round_up",
        }
        ref = match_shared(shared, low, med, high)
        if rtype == "pass_fail":
            item["pass_fail_criteria"] = {"pass": low, "fail": high}
        elif ref:
            item["criteria_ref"] = ref
        else:
            item["tier_criteria"] = {"low": low, "medium": med, "high": high}
        item["measurement"] = measurement_of(component, method, notes) if rtype == "measurement" else None
        cond = applies_when(component, notes)
        if cond:
            item["applies_when"] = cond
        item["notes_to_tech"] = norm(notes) or None
        items.append(item)
    return {
        "machine_class": machine_class,
        "drive_type": None,
        "has_def": None,
        "version": "alpha-1",
        "source": f"uptime_pm_checklists_alpha1.xlsx / tab '{tab}'",
        "items": items,
    }

class Dumper(yaml.SafeDumper):
    pass

def str_presenter(dumper, data):
    if len(data) > 80 or "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=">")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)

Dumper.add_representer(str, str_presenter)

def dump(path, data):
    with open(path, "w") as f:
        f.write("# GENERATED from the PM checklist workbook by docs/checklists/xlsx_to_yaml.py.\n")
        f.write("# Edit the workbook (or this file deliberately), then re-seed. Published templates are immutable:\n")
        f.write("# a content change must ship as a new `version`.\n")
        yaml.dump(data, f, Dumper=Dumper, sort_keys=False, allow_unicode=True, width=100)

def main():
    src, out = sys.argv[1], sys.argv[2]
    wb = openpyxl.load_workbook(src, data_only=True)
    shared = load_shared(wb)
    dump(f"{out}/_shared_criteria.yml", {"criteria": shared})
    for tab, mc in MACHINE_TABS.items():
        tpl = convert_tab(wb, tab, mc, shared)
        dump(f"{out}/{mc}.yml", tpl)
        refs = sum(1 for i in tpl["items"] if "criteria_ref" in i)
        print(f"{mc}: {len(tpl['items'])} items ({refs} via shared criteria)")

if __name__ == "__main__":
    main()
