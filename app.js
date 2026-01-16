const fileInput = document.getElementById("xmlFile");
const recordInput = document.getElementById("recordTag");
const parseBtn = document.getElementById("parseBtn");
const downloadBtn = document.getElementById("downloadBtn");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const detectedEl = document.getElementById("detected");
const tableEl = document.getElementById("table");
const groupToggle = document.getElementById("groupByBl");
const summaryEl = document.getElementById("summary");
const simpleViewToggle = document.getElementById("simpleView");
const hideStatusSToggle = document.getElementById("hideStatusS");
const dropZone = document.getElementById("dropZone");

let xmlText = "";
let currentRows = [];
let currentColumns = [];
let currentFileName = "";
let sortState = { column: "", direction: "asc" };
let groupByBl = true;
let originalRowCount = 0;
let filterState = {};
let groupState = new Map();
let simpleView = true;
let hideStatusS = true;
let progressState = new Map();

const EMPTY_TOKEN = "__EMPTY__";
const HIDDEN_COLUMNS = new Set([
  "AppErrInfDoc.ErrCodeAgy",
  "ErrPntDetailsDoc.MsgSecCode",
  "ErrPntDetailsDoc.MsgSubItmIdDoc",
  "ErrTxtDoc.RuleCode",
  "ErrTxtDoc.TxtPT",
  "ErrTxtDoc.TxtEN",
  "ErrTxtHdr.TxtPT",
  "ErrTxtHdr.TxtEN",
]);
const MESSAGE_KEYS = [
  "TxtPT",
  "TxtEN",
  "ErrTxtDoc.TxtPT",
  "ErrTxtDoc.TxtEN",
  "ErrTxtHdr.TxtPT",
  "ErrTxtHdr.TxtEN",
];
const SIMPLE_VIEW_COLUMNS = ["BL", "ErrorMessage"];
const PREFERRED_RECORD_TAGS = ["ErrTxtDoc", "ErrPntDtlDoc"];

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function stripNs(name) {
  if (name.includes("}")) {
    return name.split("}").pop();
  }
  if (name.includes(":")) {
    return name.split(":").pop();
  }
  return name;
}

function buildPath(element) {
  const parts = [];
  let node = element;
  while (node && node.nodeType === 1) {
    parts.unshift(stripNs(node.tagName));
    node = node.parentElement;
  }
  return parts.join("/");
}

function directText(element) {
  let text = "";
  element.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      text += node.nodeValue;
    }
  });
  return text.trim();
}

function addValue(target, key, value) {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    if (Array.isArray(target[key])) {
      target[key].push(value);
    } else {
      target[key] = [target[key], value];
    }
  } else {
    target[key] = value;
  }
}

function flattenElement(element, prefix = "", out = {}) {
  Array.from(element.attributes || []).forEach((attr) => {
    const key = prefix ? `${prefix}@${attr.name}` : `@${attr.name}`;
    addValue(out, key, attr.value);
  });

  const children = Array.from(element.children || []);
  if (children.length === 0) {
    const text = directText(element);
    if (text) {
      const key = prefix || stripNs(element.tagName);
      addValue(out, key, text);
    }
    return out;
  }

  children.forEach((child) => {
    const childTag = stripNs(child.tagName);
    const childPrefix = prefix ? `${prefix}.${childTag}` : childTag;
    flattenElement(child, childPrefix, out);
  });

  const text = directText(element);
  if (text) {
    const key = prefix ? `${prefix}._text` : "_text";
    addValue(out, key, text);
  }

  return out;
}

function normalizeRow(row) {
  const out = {};
  Object.keys(row).forEach((key) => {
    const value = row[key];
    if (Array.isArray(value)) {
      out[key] = value.join("; ");
    } else {
      out[key] = value == null ? "" : String(value);
    }
  });
  return out;
}

function findBlKey(row) {
  const keys = Object.keys(row);
  for (const key of keys) {
    const last = key.split(".").pop() || "";
    const clean = last.startsWith("@") ? last.slice(1) : last;
    if (clean.toLowerCase() === "trnspctrid") {
      return key;
    }
  }
  return "";
}

function findTagValue(element, tagName) {
  const target = tagName.toLowerCase();
  const elements = [element, ...Array.from(element.getElementsByTagName("*"))];
  for (const node of elements) {
    const name = stripNs(node.tagName).toLowerCase();
    if (name === target) {
      const text = directText(node);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function findNestedTagValue(element, parentTag, childTag) {
  const parentLower = parentTag.toLowerCase();
  const nodes = [element, ...Array.from(element.getElementsByTagName("*"))];
  for (const node of nodes) {
    const name = stripNs(node.tagName).toLowerCase();
    if (name === parentLower) {
      const value = findTagValue(node, childTag);
      if (value) {
        return value;
      }
    }
  }
  return "";
}

function findCodeListIdValue(element) {
  let current = element;
  while (current && current.nodeType === 1) {
    const docValue = findNestedTagValue(current, "AppErrInfDoc", "CodeLstId");
    if (docValue) {
      return docValue;
    }
    const hdrValue = findNestedTagValue(current, "AppErrInfHdr", "CodeLstId");
    if (hdrValue) {
      return hdrValue;
    }
    current = current.parentElement;
  }
  return "";
}

function findBlValue(element) {
  let current = element;
  while (current && current.nodeType === 1) {
    const value = findTagValue(current, "TrnspCtrId");
    if (value) {
      return value;
    }
    current = current.parentElement;
  }
  return "";
}

function buildColumns(rows) {
  const columns = [];
  const seen = new Set();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    });
  });
  return columns;
}

function normalizeColumns(columns) {
  const filtered = columns.filter((col) => !HIDDEN_COLUMNS.has(col));
  const prioritized = [];
  SIMPLE_VIEW_COLUMNS.forEach((col) => {
    if (filtered.includes(col)) {
      prioritized.push(col);
    }
  });
  const remainder = filtered.filter((col) => !prioritized.includes(col));
  return [...prioritized, ...remainder];
}

function applySimpleView(columns) {
  if (!simpleView) {
    return columns;
  }
  const available = SIMPLE_VIEW_COLUMNS.filter((col) => columns.includes(col));
  return available.length ? available : columns;
}

function pickFirstValue(row, keys) {
  for (const key of keys) {
    const value = normalizeCellValue(row[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function addDerivedFields(row) {
  if (!Object.prototype.hasOwnProperty.call(row, "ErrorMessage")) {
    row.ErrorMessage = pickFirstValue(row, MESSAGE_KEYS);
  }
}

function pruneEmptyColumns(rows, columns) {
  const keep = columns.filter((col) =>
    rows.some((row) => normalizeCellValue(row[col]) !== "")
  );
  if (!keep.length) {
    return columns;
  }
  const prioritized = SIMPLE_VIEW_COLUMNS.filter((col) => keep.includes(col));
  const remainder = keep.filter((col) => !prioritized.includes(col));
  return [...prioritized, ...remainder];
}

function normalizeCellValue(value) {
  return value == null ? "" : String(value);
}

function getCodeListSet(row) {
  const raw = normalizeCellValue(
    row["AppErrInfDoc.CodeLstId"] || row["AppErrInfHdr.CodeLstId"] || ""
  );
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

function applyStatusFilter(rows) {
  if (!hideStatusS) {
    return rows;
  }
  return rows.filter((row) => {
    const codes = getCodeListSet(row);
    if (!codes.size) {
      return true;
    }
    if (codes.has("E") || codes.has("W")) {
      return true;
    }
    if (codes.size === 1 && codes.has("S")) {
      return false;
    }
    return true;
  });
}

function filterRows(rows) {
  const activeColumns = Object.keys(filterState).filter(
    (col) => filterState[col] && filterState[col].size
  );
  if (!activeColumns.length) {
    return rows;
  }
  return rows.filter((row) =>
    activeColumns.every((col) => {
      const selected = filterState[col];
      const value = normalizeCellValue(row[col]);
      const token = value === "" ? EMPTY_TOKEN : value;
      return selected.has(token);
    })
  );
}

function buildUniqueValuesByColumn(rows, columns) {
  const valuesMap = new Map();
  columns.forEach((col) => valuesMap.set(col, new Set()));
  rows.forEach((row) => {
    columns.forEach((col) => {
      valuesMap.get(col).add(normalizeCellValue(row[col]));
    });
  });
  const output = new Map();
  valuesMap.forEach((values, col) => {
    const list = Array.from(values);
    list.sort((a, b) => {
      if (a === "" && b === "") {
        return 0;
      }
      if (a === "") {
        return 1;
      }
      if (b === "") {
        return -1;
      }
      return compareValues(a, b);
    });
    output.set(col, list);
  });
  return output;
}

function detectRecords(doc) {
  const groups = new Map();
  const root = doc.documentElement;
  const elements = [root, ...Array.from(root.getElementsByTagName("*"))];

  elements.forEach((element) => {
    const path = buildPath(element);
    const fieldCount = element.attributes.length + element.children.length;
    if (!groups.has(path)) {
      groups.set(path, { count: 0, fieldSum: 0, elements: [] });
    }
    const group = groups.get(path);
    group.count += 1;
    group.fieldSum += fieldCount;
    group.elements.push(element);
  });

  let best = null;
  groups.forEach((group, path) => {
    if (group.count < 2) {
      return;
    }
    const avgFields = group.fieldSum / group.count;
    const score = (avgFields + 1) * group.count;
    if (!best || score > best.score) {
      best = { path, score, elements: group.elements };
    }
  });

  if (!best) {
    const fallback = root.children.length ? Array.from(root.children) : [root];
    return { elements: fallback, path: stripNs(root.tagName) };
  }

  const parts = best.path.split("/");
  const tag = parts[parts.length - 1];
  return { elements: best.elements, path: best.path, tag };
}

function findPreferredRecords(doc) {
  for (const tag of PREFERRED_RECORD_TAGS) {
    const nodes = Array.from(doc.getElementsByTagName(tag));
    if (nodes.length) {
      const path = buildPath(nodes[0]);
      return { elements: nodes, path, tag };
    }
  }
  return null;
}

function findRecordsByTag(doc, tag) {
  const target = tag.trim().toLowerCase();
  if (!target) {
    return [];
  }

  const root = doc.documentElement;
  const elements = [root, ...Array.from(root.getElementsByTagName("*"))];
  return elements.filter(
    (element) => stripNs(element.tagName).toLowerCase() === target
  );
}

function buildTableHeader(columns, rows) {
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const valuesMap = buildUniqueValuesByColumn(rows, columns);
  columns.forEach((col) => {
    const th = document.createElement("th");
    const wrapper = document.createElement("div");
    wrapper.className = "th-cell";

    const label = document.createElement("button");
    label.type = "button";
    label.className = "th-label";
    label.textContent = col;
    label.dataset.column = col;
    label.dataset.sort = sortState.column === col ? sortState.direction : "";
    label.addEventListener("click", () => {
      toggleSort(col);
    });

    const filterWrap = document.createElement("details");
    filterWrap.className = "th-filter";

    const summary = document.createElement("summary");
    summary.className = "filter-summary";
    const summaryLabel = document.createElement("span");
    summaryLabel.className = "filter-label";
    summaryLabel.textContent = "Filter";
    const summaryCount = document.createElement("span");
    summaryCount.className = "filter-count";
    summary.appendChild(summaryLabel);
    summary.appendChild(summaryCount);

    const menu = document.createElement("div");
    menu.className = "filter-menu";
    const list = document.createElement("div");
    list.className = "filter-list";

    const values = valuesMap.get(col) || [];
    const activeSet = new Set(filterState[col] ? Array.from(filterState[col]) : []);

    function updateSummary() {
      summaryCount.textContent = activeSet.size
        ? `${activeSet.size} selected`
        : "All";
    }

    values.forEach((value) => {
      const labelWrap = document.createElement("label");
      labelWrap.className = "filter-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const token = value === "" ? EMPTY_TOKEN : value;
      checkbox.value = token;
      checkbox.checked = activeSet.has(token);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          activeSet.add(token);
        } else {
          activeSet.delete(token);
        }
        if (activeSet.size) {
          filterState[col] = new Set(activeSet);
        } else {
          delete filterState[col];
        }
        updateSummary();
        renderCurrentTable();
      });

      const text = document.createElement("span");
      text.textContent = value === "" ? "(Empty)" : value;
      labelWrap.appendChild(checkbox);
      labelWrap.appendChild(text);
      list.appendChild(labelWrap);
    });

    const actions = document.createElement("div");
    actions.className = "filter-actions";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "filter-clear";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", (event) => {
      event.preventDefault();
      activeSet.clear();
      delete filterState[col];
      Array.from(list.querySelectorAll("input[type='checkbox']")).forEach(
        (input) => {
          input.checked = false;
        }
      );
      updateSummary();
      renderCurrentTable();
    });
    actions.appendChild(clearBtn);

    updateSummary();
    menu.appendChild(list);
    menu.appendChild(actions);

    filterWrap.appendChild(summary);
    filterWrap.appendChild(menu);

    wrapper.appendChild(label);
    wrapper.appendChild(filterWrap);
    th.appendChild(wrapper);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  return thead;
}

function buildDataRow(row, columns, index) {
  const tr = document.createElement("tr");
  tr.style.setProperty("--delay", `${Math.min(index * 18, 360)}ms`);
  columns.forEach((col) => {
    const td = document.createElement("td");
    td.textContent = row[col] ?? "";
    tr.appendChild(td);
  });
  return tr;
}

function replaceTableBody(tbody) {
  const existing = tableEl.querySelector("tbody");
  if (existing) {
    existing.remove();
  }
  tableEl.appendChild(tbody);
}

function renderTableBody(rows, columns) {
  const tbody = document.createElement("tbody");
  rows.forEach((row, index) => {
    tbody.appendChild(buildDataRow(row, columns, index));
  });
  replaceTableBody(tbody);
}

function renderGroupedBody(groups, columns) {
  const tbody = document.createElement("tbody");
  let index = 0;
  groups.forEach((group) => {
    const groupKey = group.bl;
    const collapsed = isGroupCollapsed(groupKey);
    const isDone = isGroupChecked(groupKey);
    const groupRow = document.createElement("tr");
    groupRow.className = "group-row";
    if (isDone) {
      groupRow.classList.add("group-done");
    }
    const td = document.createElement("td");
    td.colSpan = columns.length;
    const rowInner = document.createElement("div");
    rowInner.className = "group-row-inner";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "group-check";
    checkbox.checked = isDone;
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", () => {
      progressState.set(groupKey, checkbox.checked);
      renderCurrentTable();
    });

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "group-toggle";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.addEventListener("click", () => {
      groupState.set(groupKey, !collapsed);
      renderCurrentTable();
    });

    const left = document.createElement("span");
    left.className = "group-left";
    const arrow = document.createElement("span");
    arrow.className = "group-arrow";
    const label = document.createElement("span");
    label.className = "group-title";
    label.textContent = `BL: ${group.bl}`;
    left.appendChild(arrow);
    left.appendChild(label);

    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = `${group.rows.length} Message(s)`;

    toggle.appendChild(left);
    toggle.appendChild(count);
    rowInner.appendChild(checkbox);
    rowInner.appendChild(toggle);
    td.appendChild(rowInner);
    groupRow.appendChild(td);
    tbody.appendChild(groupRow);

    group.rows.forEach((row) => {
      const rowEl = buildDataRow(row, columns, index);
      rowEl.hidden = collapsed;
      if (isDone) {
        rowEl.classList.add("row-done");
      }
      tbody.appendChild(rowEl);
      index += 1;
    });
  });
  replaceTableBody(tbody);
}

function updateSortIndicators() {
  const buttons = tableEl.querySelectorAll(".th-label");
  buttons.forEach((button) => {
    const column = button.dataset.column;
    button.dataset.sort =
      sortState.column === column ? sortState.direction : "";
  });
}

function closeAllFilters() {
  const filters = tableEl.querySelectorAll("details.th-filter[open]");
  filters.forEach((filter) => {
    filter.open = false;
  });
}

function buildSummary(rows) {
  const blValues = new Set();
  rows.forEach((row) => {
    const value = normalizeCellValue(row.BL);
    if (value) {
      blValues.add(value);
    }
  });
  const count = blValues.size;
  return `Selected BLs: ${count}`;
}

function isGroupCollapsed(groupKey) {
  if (groupState.has(groupKey)) {
    return groupState.get(groupKey);
  }
  return true;
}

function isGroupChecked(groupKey) {
  if (progressState.has(groupKey)) {
    return progressState.get(groupKey);
  }
  return false;
}

function groupRowsByBl(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const bl = row.BL ? row.BL : "(Sem BL)";
    if (!groups.has(bl)) {
      groups.set(bl, []);
    }
    groups.get(bl).push(row);
  });
  return Array.from(groups, ([bl, items]) => ({ bl, rows: items }));
}

function sortGroupsByBl(groups, direction) {
  const sorted = [...groups];
  sorted.sort((groupA, groupB) => {
    const result = compareValues(groupA.bl, groupB.bl);
    return direction === "asc" ? result : -result;
  });
  return sorted;
}

function renderCurrentTable() {
  if (!currentRows.length) {
    tableEl.innerHTML = "";
    if (summaryEl) {
      summaryEl.textContent = "Selected BLs: 0";
    }
    return;
  }

  const baseRows = applyStatusFilter(currentRows);
  const visibleRows = filterRows(baseRows);
  if (groupByBl) {
    let groups = groupRowsByBl(visibleRows);
    if (sortState.column) {
      if (sortState.column === "BL") {
        groups = sortGroupsByBl(groups, sortState.direction);
      } else {
        groups = groups.map((group) => ({
          bl: group.bl,
          rows: sortRows(group.rows, sortState.column, sortState.direction),
        }));
      }
    }
    renderGroupedBody(groups, currentColumns);
  } else {
    const rows = sortState.column
      ? sortRows(visibleRows, sortState.column, sortState.direction)
      : visibleRows;
    renderTableBody(rows, currentColumns);
  }

  updateSortIndicators();
  if (summaryEl) {
    summaryEl.textContent = buildSummary(visibleRows);
  }
  const filteredCount = visibleRows.length;
  if (filteredCount !== originalRowCount) {
    metaEl.textContent = `Rows: ${filteredCount} (filtered from ${originalRowCount}) | Columns: ${currentColumns.length} | File: ${currentFileName}`;
  } else {
    metaEl.textContent = `Rows: ${originalRowCount} | Columns: ${currentColumns.length} | File: ${currentFileName}`;
  }
}

function compareValues(a, b) {
  const numA = Number(a);
  const numB = Number(b);
  const isNumA = !Number.isNaN(numA) && String(a).trim() !== "";
  const isNumB = !Number.isNaN(numB) && String(b).trim() !== "";
  if (isNumA && isNumB) {
    return numA - numB;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function sortRows(rows, column, direction) {
  const sorted = [...rows];
  sorted.sort((rowA, rowB) => {
    const a = rowA[column] ?? "";
    const b = rowB[column] ?? "";
    const result = compareValues(a, b);
    return direction === "asc" ? result : -result;
  });
  return sorted;
}

function toggleSort(column) {
  if (!currentRows.length) {
    return;
  }
  if (sortState.column === column) {
    sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
  } else {
    sortState.column = column;
    sortState.direction = "asc";
  }
  renderCurrentTable();
}

function escapeCsvValue(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(rows, columns) {
  const lines = [];
  lines.push(columns.map(escapeCsvValue).join(","));
  rows.forEach((row) => {
    const line = columns.map((col) => escapeCsvValue(row[col] ?? ""));
    lines.push(line.join(","));
  });
  return lines.join("\n");
}

function parseAndRender() {
  if (!xmlText) {
    setStatus("Select an XML file first.", "error");
    return;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parserErrors = doc.getElementsByTagName("parsererror");
  if (parserErrors.length) {
    setStatus("Invalid XML file. Please choose another file.", "error");
    return;
  }

  const manualTag = recordInput ? recordInput.value.trim() : "";
  let records = [];
  let usedPath = "";

  if (manualTag) {
    records = findRecordsByTag(doc, manualTag);
    usedPath = manualTag;
  } else {
    const preferred = findPreferredRecords(doc);
    const detected = preferred || detectRecords(doc);
    records = detected.elements;
    usedPath = detected.path;
  }

  if (!records.length) {
    setStatus("No records found. Try a different record tag.", "error");
    tableEl.innerHTML = "";
    currentRows = [];
    currentColumns = [];
    downloadBtn.disabled = true;
    metaEl.textContent = "No data yet.";
    detectedEl.textContent = "";
    if (summaryEl) {
      summaryEl.textContent = "Selected BLs: 0";
    }
    return;
  }

  const rows = records.map((record) => {
    const flat = normalizeRow(flattenElement(record));
    addDerivedFields(flat);
    if (!Object.prototype.hasOwnProperty.call(flat, "BL")) {
      const blKey = findBlKey(flat);
      if (blKey) {
        flat.BL = flat[blKey];
      } else {
        const blValue = findBlValue(record);
        if (blValue) {
          flat.BL = blValue;
        }
      }
    }
    if (
      !Object.prototype.hasOwnProperty.call(flat, "AppErrInfDoc.CodeLstId") &&
      !Object.prototype.hasOwnProperty.call(flat, "AppErrInfHdr.CodeLstId")
    ) {
      const codeValue = findCodeListIdValue(record);
      if (codeValue) {
        flat["AppErrInfDoc.CodeLstId"] = codeValue;
      }
    }
    return flat;
  });
  const columns = pruneEmptyColumns(
    rows,
    applySimpleView(normalizeColumns(buildColumns(rows)))
  );

  currentRows = rows;
  currentColumns = columns;
  originalRowCount = rows.length;
  sortState = { column: "", direction: "asc" };
  filterState = {};
  groupState = new Map();
  progressState = new Map();
  tableEl.innerHTML = "";
  tableEl.appendChild(
    buildTableHeader(currentColumns, applyStatusFilter(currentRows))
  );
  renderCurrentTable();
  downloadBtn.disabled = false;
  setStatus(`Loaded ${records.length} records.`, "");
  detectedEl.textContent = `Record path: ${usedPath}`;
}

if (groupToggle) {
  groupByBl = groupToggle.checked;
  groupToggle.addEventListener("change", () => {
    groupByBl = groupToggle.checked;
    renderCurrentTable();
  });
}

if (simpleViewToggle) {
  simpleView = simpleViewToggle.checked;
  simpleViewToggle.addEventListener("change", () => {
    simpleView = simpleViewToggle.checked;
    if (currentRows.length) {
      filterState = {};
      currentColumns = pruneEmptyColumns(
        currentRows,
        applySimpleView(normalizeColumns(buildColumns(currentRows)))
      );
      tableEl.innerHTML = "";
      tableEl.appendChild(
        buildTableHeader(currentColumns, applyStatusFilter(currentRows))
      );
      renderCurrentTable();
    }
  });
}

if (hideStatusSToggle) {
  hideStatusS = hideStatusSToggle.checked;
  hideStatusSToggle.addEventListener("change", () => {
    hideStatusS = hideStatusSToggle.checked;
    if (currentRows.length) {
      filterState = {};
      tableEl.innerHTML = "";
      tableEl.appendChild(buildTableHeader(currentColumns, applyStatusFilter(currentRows)));
      renderCurrentTable();
    }
  });
}

document.addEventListener("click", (event) => {
  const target = event.target;
  const isInsideFilter =
    target instanceof Element && target.closest(".th-filter");
  if (!isInsideFilter) {
    closeAllFilters();
  }
});

function loadXmlFile(file) {
  if (!file) {
    return;
  }
  currentFileName = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    xmlText = reader.result;
    setStatus(`File loaded: ${file.name}`);
    parseAndRender();
  };
  reader.readAsText(file);
}

fileInput.addEventListener("change", (event) => {
  loadXmlFile(event.target.files[0]);
});

if (dropZone) {
  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("is-dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("is-dragover");
    });
  });

  dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    loadXmlFile(file);
  });
}

parseBtn.addEventListener("click", () => {
  parseAndRender();
});

downloadBtn.addEventListener("click", () => {
  if (!currentRows.length) {
    return;
  }
  const visibleRows = filterRows(applyStatusFilter(currentRows));
  const csv = buildCsv(visibleRows, currentColumns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const base = currentFileName ? currentFileName.replace(/\.[^.]+$/, "") : "table";
  link.href = url;
  link.download = `${base}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});
