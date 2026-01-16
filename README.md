# XML to Table

Two options:

1) Browser app: open `index.html`, upload the XML, and see the table instantly.
2) CLI tool: convert XML to Excel (or CSV) via Python.

## Usage

### Browser app

Open `XML_TOOL/index.html` in your browser and upload an XML file.
Use "Group errors by BL" to cluster error rows by BL with a header row per BL.
Each column header has a filter dropdown with checkboxes to select multiple values.
BL groups start collapsed; click the BL header row to expand or collapse.
Enable "Simple view" to show just BL and the error message for a cleaner view.
Use "Show only E/W (hide S)" to focus on real errors while still allowing S rows when needed.
When XML contains `ErrTxtDoc`, the app uses it as the default record to show one row per error message.

### CLI tool

```bash
python xml_to_table.py --input "C:\path\file.xml"
```

If the XML has a known record tag:

```bash
python xml_to_table.py --input "C:\path\file.xml" --record-tag Item
```

If you want to use an explicit path (ElementTree syntax):

```bash
python xml_to_table.py --input "C:\path\file.xml" --record-path ".//Item"
```

Process a folder of XML files:

```bash
python xml_to_table.py --input "C:\path\folder" --add-source
```

## Output

- Default output is an Excel file next to the input file, or `xml_table.xlsx` in a folder.
- Nested nodes are flattened using dot notation, for example `Parent.Child`.
- Attributes use `@`, for example `@id` or `Item@code`.
- Repeated values are joined with `; `.
- If `TrnspCtrId` exists anywhere above each record, it is copied into a `BL` column.

If auto-detection is wrong, re-run with `--record-tag` or `--record-path`.

## Dependencies

To export Excel files:

```bash
pip install pandas openpyxl
```

You can still export CSV by passing a `.csv` path to `--output`.
