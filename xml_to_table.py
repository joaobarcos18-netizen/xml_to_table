import argparse
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def strip_ns(tag: str) -> str:
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def iter_elements_with_paths(root: ET.Element):
    stack = [(root, [strip_ns(root.tag)])]
    while stack:
        elem, path = stack.pop()
        yield elem, "/".join(path)
        children = list(elem)
        for child in reversed(children):
            stack.append((child, path + [strip_ns(child.tag)]))


def guess_records(root: ET.Element):
    groups = {}
    for elem, path in iter_elements_with_paths(root):
        groups.setdefault(path, []).append(elem)

    best_path = None
    best_score = -1
    for path, elems in groups.items():
        if len(elems) < 2:
            continue
        field_counts = [len(e.attrib) + len(list(e)) for e in elems]
        avg_fields = sum(field_counts) / len(field_counts)
        score = (avg_fields + 1) * len(elems)
        if score > best_score:
            best_score = score
            best_path = path

    if best_path is None:
        return [], None
    return groups[best_path], best_path


def add_value(data: dict, key: str, value):
    if key in data:
        existing = data[key]
        if isinstance(existing, list):
            existing.append(value)
        else:
            data[key] = [existing, value]
    else:
        data[key] = value


def flatten_element(elem: ET.Element, prefix: str = "", data: dict | None = None):
    if data is None:
        data = {}

    for k, v in elem.attrib.items():
        key = f"{prefix}@{k}" if prefix else f"@{k}"
        add_value(data, key, v.strip() if isinstance(v, str) else v)

    children = list(elem)
    if not children:
        text = (elem.text or "").strip()
        if text:
            key = prefix if prefix else strip_ns(elem.tag)
            add_value(data, key, text)
        return data

    for child in children:
        child_tag = strip_ns(child.tag)
        child_prefix = f"{prefix}.{child_tag}" if prefix else child_tag
        flatten_element(child, child_prefix, data)

    text = (elem.text or "").strip()
    if text:
        key = f"{prefix}._text" if prefix else "_text"
        add_value(data, key, text)

    return data


def normalize_row(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if isinstance(v, list):
            out[k] = "; ".join(str(x) for x in v)
        else:
            out[k] = str(v) if v is not None else ""
    return out


def find_bl_key(row: dict) -> str:
    for key in row.keys():
        last = key.split(".")[-1] if key else ""
        clean = last[1:] if last.startswith("@") else last
        if clean.lower() == "trnspctrid":
            return key
    return ""


def strip_ns_tag(tag: str) -> str:
    return tag.split("}", 1)[1] if tag.startswith("{") else tag


def find_tag_value(elem: ET.Element, tag_name: str) -> str:
    target = tag_name.lower()
    for node in elem.iter():
        name = strip_ns_tag(node.tag).lower()
        if name == target:
            text = (node.text or "").strip()
            if text:
                return text
    return ""


def find_bl_value(elem: ET.Element, parent_map: dict) -> str:
    current = elem
    while current is not None:
        value = find_tag_value(current, "TrnspCtrId")
        if value:
            return value
        current = parent_map.get(current)
    return ""


def rows_from_xml(path: Path, record_tag: str | None, record_path: str | None):
    tree = ET.parse(path)
    root = tree.getroot()
    parent_map = {child: parent for parent in root.iter() for child in parent}

    if record_path:
        records = root.findall(record_path)
        used = record_path
    elif record_tag:
        records = root.findall(".//" + record_tag)
        used = ".//" + record_tag
    else:
        records, used = guess_records(root)

    if not records:
        return [], used

    rows = []
    for record in records:
        row = normalize_row(flatten_element(record))
        if "BL" not in row:
            bl_key = find_bl_key(row)
            if bl_key:
                row["BL"] = row.get(bl_key, "")
            else:
                bl_value = find_bl_value(record, parent_map)
                if bl_value:
                    row["BL"] = bl_value
        rows.append(row)
    return rows, used


def collect_xml_files(input_path: Path):
    if input_path.is_file():
        return [input_path]
    return sorted(input_path.rglob("*.xml"))


HIDDEN_COLUMNS = {
    "AppErrInfDoc.ErrCodeAgy",
    "ErrPntDetailsDoc.MsgSecCode",
    "ErrPntDetailsDoc.MsgSubItmIdDoc",
    "ErrTxtDoc.RuleCode",
}


def build_fieldnames(rows: list[dict]) -> list[str]:
    fieldnames = []
    seen = set()
    for row in rows:
        for key in row.keys():
            if key not in seen:
                seen.add(key)
                fieldnames.append(key)
    filtered = [name for name in fieldnames if name not in HIDDEN_COLUMNS]
    if "BL" in filtered:
        filtered.remove("BL")
        filtered.insert(0, "BL")
    return filtered


def write_excel(rows: list[dict], output_path: Path, fieldnames: list[str]):
    try:
        import pandas as pd
    except ImportError:
        print("Missing dependency: pandas. Install with: pip install pandas openpyxl", file=sys.stderr)
        sys.exit(1)

    df = pd.DataFrame(rows, columns=fieldnames)
    try:
        df.to_excel(output_path, index=False)
    except ImportError:
        print("Missing dependency: openpyxl. Install with: pip install openpyxl", file=sys.stderr)
        sys.exit(1)


def write_csv(rows: list[dict], output_path: Path, delimiter: str, fieldnames: list[str]):
    import csv

    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, delimiter=delimiter)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description="Convert XML to table (Excel).")
    parser.add_argument("--input", "-i", required=True, help="XML file or folder")
    parser.add_argument("--output", "-o", help="Output file path (.xlsx or .csv)")
    parser.add_argument("--record-tag", help="Record tag to use for rows")
    parser.add_argument("--record-path", help="Record path (ElementTree syntax)")
    parser.add_argument("--delimiter", default=",", help="CSV delimiter (default ',')")
    parser.add_argument("--add-source", action="store_true", help="Add _source_file column")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Input not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    xml_files = collect_xml_files(input_path)
    if not xml_files:
        print(f"No XML files found in {input_path}", file=sys.stderr)
        sys.exit(1)

    all_rows = []
    used_paths = {}
    for xml_file in xml_files:
        try:
            rows, used = rows_from_xml(xml_file, args.record_tag, args.record_path)
        except ET.ParseError as exc:
            print(f"Parse error in {xml_file}: {exc}", file=sys.stderr)
            continue

        if not rows:
            print(f"No records found in {xml_file} (used: {used})")
            continue

        if args.add_source:
            for row in rows:
                row["_source_file"] = str(xml_file)

        all_rows.extend(rows)
        used_paths[str(xml_file)] = used

    if not all_rows:
        print("No rows extracted.", file=sys.stderr)
        sys.exit(1)

    if args.output:
        output_path = Path(args.output)
    else:
        output_path = input_path.with_suffix(".xlsx") if input_path.is_file() else input_path / "xml_table.xlsx"

    fieldnames = build_fieldnames(all_rows)
    if output_path.suffix.lower() == ".csv":
        write_csv(all_rows, output_path, delimiter=args.delimiter, fieldnames=fieldnames)
    else:
        write_excel(all_rows, output_path, fieldnames)

    print(f"Created: {output_path}")

    if used_paths:
        first_file = next(iter(used_paths))
        print(f"Record path used for {first_file}: {used_paths[first_file]}")
        if len(used_paths) > 1:
            print("Use --record-tag or --record-path if detection is not correct.")


if __name__ == "__main__":
    main()
