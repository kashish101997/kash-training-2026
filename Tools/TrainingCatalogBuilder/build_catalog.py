#!/usr/bin/env python3
"""Build the private Kash Strap TrainingCatalog without copying source PDFs into the web source.

The generated JSON is intentionally written under PrivateTrainingContent, which is gitignored. Each
session carries a source page/reference and stable ID. Image-only Ben Parkes tables are OCRed locally;
the audit file records counts and hashes for review before an encrypted Neon import.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber
from pypdf import PdfReader

DAY_NAMES = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]

SOURCES = [
    ("personalized-html", "Personalized 2026 calendar", "html", "Kash_Annual_Training_Plan_2026.html"),
    ("hyrox-mumbai-2026", "HYROX Mumbai comprehensive block", "pdf", "HYROX Plan.pdf"),
    ("tcs-10k", "TCS World 10K plan", "pdf", "TCS World 10k Plan Overview.pdf"),
    ("run-walk", "Run/Walk Method", "pdf", "619416283-The-RunWalk-Method-design-EN.pdf"),
    ("ben-5k", "Ben Parkes 5K Plan", "pdf", "Ben Parkes 5k Plan.pdf"),
    ("marathon-l1", "Ben Parkes Marathon Level 1", "pdf", "Marathon L1.pdf"),
    ("marathon-l3", "Ben Parkes Marathon Level 3", "pdf", "Ben Parked Marathon Plan L3.pdf"),
    ("marathon-l4", "Ben Parkes Marathon Level 4", "pdf", "Ben Parkes 18 Week Marathon Plan L4.pdf"),
    ("t20-strike", "T20 Strike fast-bowling program", "pdf", "448312787-Book-For-Fast-Bowllers.pdf"),
    ("bowling-drills", "Fast Bowling Drills", "reference", "612650731-Fast-Bowling-Drills.pdf"),
    ("bowling-biomechanics", "Biomechanical Analysis of Cricket Fast Bowling", "reference", "650799696-Biomechanical-Analysis-of-CRICKET-Fast-Bowling.pdf"),
    ("pace-secrets", "Ultimate Pace Secrets", "reference", "Ultimate Pace Secrets.pdf"),
    ("bowling-nutrition", "Fast-bowling nutrition and accuracy research", "reference", "580465927-Varun.pdf"),
]


def normalized(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("|", " ")).strip()


def modality(text: str) -> str:
    value = text.lower()
    if re.search(r"bowl|cricket|yorker|bouncer|swing", value):
        return "bowling"
    if re.search(r"strength|squat|circuit|deadlift|bridge|lung|core", value):
        return "strength"
    if re.search(r"walk", value) and not re.search(r"run", value):
        return "walk"
    if re.search(r"run|tempo|interval|repeat|race|parkrun|jog|strides", value):
        return "run"
    if re.search(r"mobility|recovery", value):
        return "recovery"
    return "other"


def distance_meters(text: str) -> int | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*(?:km|k)\b", text, re.I)
    if match:
        return round(float(match.group(1)) * 1000)
    miles = re.search(r"(\d+(?:\.\d+)?)\s*(?:mile|miles)\b", text, re.I)
    return round(float(miles.group(1)) * 1609.344) if miles else None


def duration_seconds(text: str) -> int | None:
    match = re.search(r"(\d+)\s*(?:m|min|mins|minutes)\b", text, re.I)
    return int(match.group(1)) * 60 if match else None


def session(plan_id: str, week: int, day: int, text: str, reference: str, *, title: str | None = None,
            estimated_load: float | None = None, segments: list[dict] | None = None) -> dict:
    text = normalized(text)
    session_id = f"{plan_id}-w{week}-d{day + 1}"
    distance = distance_meters(text)
    duration = duration_seconds(text)
    kind = modality(text)
    if estimated_load is None:
        estimated_load = max(10, distance / 100) if distance else max(8, duration / 60 * 1.2) if duration else 45 if kind in {"strength", "bowling"} else 15
    return {
        "id": session_id,
        "dayOffset": (week - 1) * 7 + day,
        "title": title or text[:90] or "Source schedule",
        "modality": kind,
        "distanceMeters": distance,
        "durationSeconds": duration,
        "intensity": intensity(text),
        "instructions": text or "Review the cited private source page.",
        "sourceReference": reference,
        "estimatedLoad": round(float(estimated_load), 1),
        "segments": segments or [],
    }


def intensity(text: str) -> str | None:
    value = text.lower()
    for token in ("recovery", "easy", "steady", "tempo", "interval", "race", "strength", "moderate", "challenging"):
        if token in value:
            return token
    return None


def week(plan_id: str, index: int, title: str, sessions: list[dict]) -> dict:
    return {"id": f"{plan_id}-w{index}", "index": index, "title": title, "sessions": sessions}


def table_plans(root: Path) -> list[dict]:
    return [tcs_plan(root), run_walk_plan(root), advanced_marathon(root)]


def tcs_plan(root: Path) -> dict:
    path = root / "TCS World 10k Plan Overview.pdf"
    weeks = []
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            for table in page.extract_tables():
                for row in table:
                    match = re.search(r"WEEK\s*(\d+)", normalized(row[0] if row else ""), re.I)
                    if not match or len(row) < 8:
                        continue
                    index = int(match.group(1))
                    sessions = []
                    for day, cell in enumerate(row[1:8]):
                        text = normalized(cell)
                        if not text or re.fullmatch(r"rest(?: day)?", text, re.I):
                            continue
                        sessions.append(session("tcs-world-10k", index, day, text, f"TCS World 10k Plan Overview.pdf · page {page_number}, week {index}, {DAY_NAMES[day].title()}"))
                    weeks.append(week("tcs-world-10k", index, f"Week {index}", sessions))
    weeks.sort(key=lambda value: value["index"])
    return plan("tcs-world-10k", "TCS World 10K", "13-week source schedule extracted from the Runna overview.", "run", "tcs-10k", weeks)


def run_walk_plan(root: Path) -> dict:
    path = root / "619416283-The-RunWalk-Method-design-EN.pdf"
    with pdfplumber.open(path) as pdf:
        schedule = pdf.pages[4].extract_tables()[0]
        ratios = pdf.pages[5].extract_tables()[0]
    ratio_by_week = {}
    for fallback_index, row in enumerate(ratios[1:], 1):
        if row:
            index = int(normalized(row[0])) if normalized(row[0]).isdigit() else fallback_index
            ratio_by_week[index] = " · ".join(filter(None, map(normalized, row[1:4])))
    weeks = []
    for fallback_index, row in enumerate(schedule[1:], 1):
        if not row:
            continue
        index = int(normalized(row[0])) if normalized(row[0]).isdigit() else fallback_index
        sessions = []
        for day, cell in enumerate(row[1:8]):
            text = normalized(cell)
            if not text or re.fullmatch(r"rest", text, re.I):
                continue
            detail = f"{text}. Choose the matching current level: {ratio_by_week.get(index, 'See source ratio chart')}"
            sessions.append(session("run-walk-method", index, day, detail, f"619416283-The-RunWalk-Method-design-EN.pdf · pages 5–6, week {index}, {DAY_NAMES[day].title()}"))
        weeks.append(week("run-walk-method", index, f"Week {index}", sessions))
    return plan("run-walk-method", "Run/Walk Method", "Eight-week schedule retaining the source's easy, moderate, and challenging ratio choices.", "run", "run-walk", weeks)


def advanced_marathon(root: Path) -> dict:
    path = root / "Ben Parkes 18 Week Marathon Plan L4.pdf"
    weeks = []
    with pdfplumber.open(path) as pdf:
        for page_number in range(2, 7):
            for table in pdf.pages[page_number - 1].extract_tables():
                for row in table:
                    if len(row) < 10 or not normalized(row[2]).isdigit():
                        continue
                    index = int(normalized(row[2]))
                    sessions = []
                    for day, cell in enumerate(row[3:10]):
                        text = normalized(cell)
                        if not text or re.fullmatch(r"rest(?: day)?", text, re.I):
                            continue
                        sessions.append(session("ben-parkes-marathon-l4", index, day, text, f"Ben Parkes 18 Week Marathon Plan L4.pdf · page {page_number}, week {index}, {DAY_NAMES[day].title()}"))
                    weeks.append(week("ben-parkes-marathon-l4", index, f"Week {index}", sessions))
    weeks.sort(key=lambda value: value["index"])
    return plan("ben-parkes-marathon-l4", "Ben Parkes Marathon Level 4", "18-week advanced marathon schedule extracted from the source tables.", "run", "marathon-l4", weeks)


def ocr_words(path: Path, page_number: int) -> list[dict]:
    with tempfile.TemporaryDirectory(prefix="kash-catalog-ocr-") as temp:
        output = Path(temp) / "page"
        subprocess.run(["pdftoppm", "-f", str(page_number), "-l", str(page_number), "-r", "250", "-png", "-singlefile", str(path), str(output)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        raw = subprocess.check_output(["tesseract", str(output.with_suffix(".png")), "stdout", "--psm", "6", "tsv"], stderr=subprocess.DEVNULL, text=True)
    words = []
    for row in csv.DictReader(io.StringIO(raw), delimiter="\t"):
        text = normalized(row.get("text"))
        if not text or float(row.get("conf") or -1) < 15:
            continue
        words.append({
            "text": text, "left": int(row["left"]), "top": int(row["top"]),
            "width": int(row["width"]), "height": int(row["height"]),
            "word_num": int(row["word_num"]),
            "line": (row["block_num"], row["par_num"], row["line_num"]),
        })
    return words


def group_lines(words: list[dict]) -> list[dict]:
    grouped = {}
    for word in words:
        grouped.setdefault(word["line"], []).append(word)
    lines = []
    for values in grouped.values():
        values.sort(key=lambda item: item["left"])
        lines.append({"top": min(item["top"] for item in values), "bottom": max(item["top"] + item["height"] for item in values), "text": " ".join(item["text"] for item in values), "words": values})
    return sorted(lines, key=lambda item: item["top"])


def ocr_table_weeks(path: Path, pages: list[tuple[int, list[int]]], plan_id: str, expected: int) -> list[dict]:
    extracted = {}
    for page_number, expected_on_page in pages:
        words = ocr_words(path, page_number)
        lines = group_lines(words)
        markers = []
        for line in lines:
            match = re.search(r"WEEKS?\s*(\d+)", line["text"], re.I)
            if match:
                markers.append((int(match.group(1)), line["top"], line))
        # Several image-only tables print WEEK only once and then a bare number in the left gutter.
        # Recover those row anchors from high-confidence first words, constrained to the known page range.
        page_width = max(word["left"] + word["width"] for word in words)
        existing = {item[0] for item in markers}
        for word in words:
            if (word["left"] < page_width * 0.24
                    and word["text"].isdigit() and int(word["text"]) in expected_on_page
                    and int(word["text"]) not in existing):
                matching_line = next((line for line in lines if line["top"] <= word["top"] <= line["bottom"]), None)
                markers.append((int(word["text"]), word["top"], matching_line or {"top": word["top"], "bottom": word["top"] + word["height"], "text": word["text"], "words": [word]}))
                existing.add(int(word["text"]))
        repeated_day_headers = [
            line for line in lines
            if sum(1 for name in DAY_NAMES if name in re.sub(r"[^A-Z ]", "", line["text"].upper())) >= 5
        ]
        if len({item[0] for item in markers}) < len(expected_on_page) and len(repeated_day_headers) == len(expected_on_page):
            markers = [
                (index, repeated_day_headers[offset]["top"], repeated_day_headers[offset])
                for offset, index in enumerate(expected_on_page)
            ]
        # The 5K images occasionally drop the bare week numeral too, but every row ends with the
        # printed "TRAINING LOAD" label. When its count matches the known source page range, those
        # separators are safer than guessing a missing numeral from workout text.
        load_lines = [line for line in lines if re.search(r"TRAINING\s+LOAD", line["text"], re.I)]
        if len({item[0] for item in markers}) < len(expected_on_page) and len(load_lines) == len(expected_on_page):
            page_top = min(word["top"] for word in words)
            starts = [page_top] + [line["bottom"] + 1 for line in load_lines[:-1]]
            markers = [(index, starts[offset], {"top": starts[offset], "bottom": starts[offset], "text": str(index), "words": []}) for offset, index in enumerate(expected_on_page)]
        markers = sorted((item for item in markers if item[0] in expected_on_page), key=lambda item: item[1])
        for marker_index, (index, top, marker_line) in enumerate(markers):
            bottom = markers[marker_index + 1][1] if marker_index + 1 < len(markers) else max(item["bottom"] for item in lines) + 1
            region = [word for word in words if top - 10 <= word["top"] < bottom]
            headers = {}
            for word in region:
                token = re.sub(r"[^A-Z]", "", word["text"].upper())
                if token in DAY_NAMES and token not in headers:
                    headers[token] = word
            note_tops = [line["top"] for line in lines if top < line["top"] < bottom and re.match(r"\s*NOTES?\b", line["text"], re.I)]
            content_bottom = min(note_tops) if note_tops else bottom
            sessions = []
            if len(headers) >= 5:
                centers = []
                for day_name in DAY_NAMES:
                    word = headers.get(day_name)
                    centers.append(word["left"] + word["width"] / 2 if word else None)
                known = [(i, value) for i, value in enumerate(centers) if value is not None]
                for day in range(7):
                    if centers[day] is None:
                        before = max((item for item in known if item[0] < day), default=known[0])
                        after = min((item for item in known if item[0] > day), default=known[-1])
                        centers[day] = before[1] + (after[1] - before[1]) * ((day - before[0]) / max(1, after[0] - before[0]))
                boundaries = [-10**9] + [(centers[i] + centers[i + 1]) / 2 for i in range(6)] + [10**9]
                header_bottom = max(word["top"] + word["height"] for word in headers.values())
                for day in range(7):
                    cell_words = [word for word in region if header_bottom < word["top"] < content_bottom and boundaries[day] <= word["left"] + word["width"] / 2 < boundaries[day + 1]]
                    text = normalized(" ".join(line["text"] for line in group_lines(cell_words)))
                    text = re.sub(r"\b(?:PHASE|TOTAL|LOAD)\b", "", text, flags=re.I).strip()
                    if not text or re.fullmatch(r"rest(?: day)?", text, re.I):
                        continue
                    sessions.append(session(plan_id, index, day, text, f"{path.name} · page {page_number}, week {index}, {DAY_NAMES[day].title()}"))
            if not sessions:
                # Honest fallback for an OCR layout that cannot safely recover columns: retain the source
                # block as one schedulable review session instead of inventing seven cells.
                block = normalized(" ".join(line["text"] for line in lines if top <= line["top"] < content_bottom))
                sessions = [session(plan_id, index, 0, block, f"{path.name} · page {page_number}, week {index}", title="Review source schedule")]
            extracted[index] = week(plan_id, index, f"Week {index}", sessions)
    missing = sorted(set(range(1, expected + 1)) - set(extracted))
    if missing:
        raise ValueError(f"OCR did not find {path.name} weeks: {missing}")
    return [extracted[index] for index in range(1, expected + 1)]


def ocr_plans(root: Path) -> list[dict]:
    specs = [
        ("Ben Parkes 5k Plan.pdf", [(7, list(range(1, 5))), (8, list(range(5, 9)))], "ben-parkes-5k-l4", 8, "Ben Parkes 5K Level 4", "ben-5k"),
        ("Marathon L1.pdf", [(8, list(range(1, 6))), (9, list(range(6, 11))), (10, list(range(11, 15))), (11, list(range(15, 19)))], "ben-parkes-marathon-l1", 18, "Ben Parkes Marathon Level 1", "marathon-l1"),
        ("Ben Parked Marathon Plan L3.pdf", [(8, list(range(1, 6))), (9, list(range(6, 11))), (10, list(range(11, 16)))], "ben-parkes-marathon-l3", 15, "Ben Parkes Marathon Level 3", "marathon-l3"),
    ]
    result = []
    for filename, pages, plan_id, count, title, source_id in specs:
        weeks = ocr_table_weeks(root / filename, pages, plan_id, count)
        result.append(plan(plan_id, title, f"{count}-week schedule OCRed locally from the private kilometer tables; every cell retains its source page.", "run", source_id, weeks))
    return result


def t20_plan(root: Path) -> dict:
    path = root / "448312787-Book-For-Fast-Bowllers.pdf"
    text = subprocess.check_output(["pdftotext", "-layout", str(path), "-"], text=True)
    matches = list(re.finditer(r"WEEK\s+(\d+)\s*:\s*([^\n]+)", text, re.I))
    weeks = []
    for offset, match in enumerate(matches):
        index = int(match.group(1))
        if not 1 <= index <= 6 or any(item["index"] == index for item in weeks):
            continue
        end = matches[offset + 1].start() if offset + 1 < len(matches) else len(text)
        block = text[match.start():end]
        outline = block[block.find("SESSION OUTLINE"):] if "SESSION OUTLINE" in block else block
        outline = normalized(re.sub(r"www\.[^\s]+", "", outline))
        headings = [heading for heading in ("WARM UP", "BOWLING FOCUS", "STRENGTH & CONDITIONING") if heading in outline]
        segments = [{"id": f"t20-strike-bowling-w{index}-d1-segment-{i+1}", "kind": "module", "repetitions": None, "distanceMeters": None, "durationSeconds": None, "target": None, "instructions": heading} for i, heading in enumerate(headings)]
        item = session("t20-strike-bowling", index, 0, outline[:6000], f"448312787-Book-For-Fast-Bowllers.pdf · week {index} session outline", title=normalized(match.group(2)).title(), estimated_load=60, segments=segments)
        weeks.append(week("t20-strike-bowling", index, f"Week {index} · {normalized(match.group(2)).title()}", [item]))
    if len(weeks) != 6:
        raise ValueError(f"Expected 6 T20 Strike weeks, got {len(weeks)}")
    return plan("t20-strike-bowling", "T20 Strike bowling program", "Six-week bowling workload, skill, prehab, and conditioning modules.", "bowling", "t20-strike", weeks)


def plan(plan_id: str, title: str, summary: str, kind: str, source_id: str, weeks: list[dict]) -> dict:
    return {"id": plan_id, "version": 1, "title": title, "summary": summary, "modality": kind, "datePolicy": "relative", "fixedStartDate": None, "sourceID": source_id, "weeks": weeks}


def validate(catalog: dict) -> dict:
    expected = {
        "personalized-2026-47w": 47, "hyrox-current": 6, "half-marathon-current": 12,
        "tcs-world-10k": 13, "run-walk-method": 8, "ben-parkes-5k-l4": 8,
        "ben-parkes-marathon-l1": 18, "ben-parkes-marathon-l3": 15,
        "ben-parkes-marathon-l4": 18, "t20-strike-bowling": 6,
    }
    audit = {"schemaVersion": catalog["schemaVersion"], "plans": {}}
    ids = set()
    for value in catalog["plans"]:
        if value["id"] in ids:
            raise ValueError(f"Duplicate plan ID {value['id']}")
        ids.add(value["id"])
        if len(value["weeks"]) != expected[value["id"]]:
            raise ValueError(f"{value['id']}: expected {expected[value['id']]} weeks, got {len(value['weeks'])}")
        session_ids = [item["id"] for item in value["weeks"] for item in item["sessions"]]
        if len(session_ids) != len(set(session_ids)):
            raise ValueError(f"Duplicate session ID in {value['id']}")
        if not session_ids:
            raise ValueError(f"No sessions in {value['id']}")
        audit["plans"][value["id"]] = {"weekCount": len(value["weeks"]), "sessionCount": len(session_ids), "stableIDHash": hashlib.sha256("\n".join(session_ids).encode()).hexdigest()}
    return audit


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    output = args.output or root / "PrivateTrainingContent/TrainingCatalog.generated.json"
    missing = [filename for _, _, _, filename in SOURCES if not (root / filename).exists()]
    if missing:
        raise SystemExit(f"Missing private sources: {', '.join(missing)}")

    html_helper = Path(__file__).with_name("extract_html_plans.mjs")
    html_plans = json.loads(subprocess.check_output(["node", str(html_helper), str(root / "Kash_Annual_Training_Plan_2026.html")], text=True))
    hyrox_override_path = root / "PrivateTrainingContent/HyroxMumbai2026.plan.json"
    if not hyrox_override_path.exists():
        raise SystemExit(f"Missing private HYROX override: {hyrox_override_path}")
    hyrox_override = json.loads(hyrox_override_path.read_text(encoding="utf-8"))
    html_plans = [hyrox_override if value["id"] == "hyrox-current" else value for value in html_plans]
    catalog = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sources": [
            {"id": source_id, "title": title, "kind": kind, "localFileName": filename, "referenceURL": None, "privateContent": True}
            for source_id, title, kind, filename in SOURCES
        ],
        "plans": html_plans + table_plans(root) + ocr_plans(root) + [t20_plan(root)],
    }
    audit = validate(catalog)
    audit["sources"] = {
        filename: {"sha256": hashlib.sha256((root / filename).read_bytes()).hexdigest(), "pages": len(PdfReader(root / filename).pages) if filename.lower().endswith(".pdf") else None}
        for _, _, _, filename in SOURCES
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    audit_path = output.with_name("TrainingCatalog.audit.json")
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")
    print(f"Wrote {audit_path}")
    for plan_id, values in audit["plans"].items():
        print(f"{plan_id}: {values['weekCount']} weeks, {values['sessionCount']} sessions")


if __name__ == "__main__":
    main()
