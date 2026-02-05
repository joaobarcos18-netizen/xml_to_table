(() => {
  const app = window.XmlTable || (window.XmlTable = {});

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

  function applySimpleView(columns, simpleView) {
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

  function computeColumns(rows, simpleView) {
    return pruneEmptyColumns(
      rows,
      applySimpleView(normalizeColumns(buildColumns(rows)), simpleView)
    );
  }

  function parseXml(xmlText, { recordTag = "", simpleView = true } = {}) {
    if (!xmlText) {
      return { error: "Select an XML file first.", errorType: "missing-xml" };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const parserErrors = doc.getElementsByTagName("parsererror");
    if (parserErrors.length) {
      return {
        error: "Invalid XML file. Please choose another file.",
        errorType: "invalid-xml",
      };
    }

    let records = [];
    let usedPath = "";

    if (recordTag) {
      records = findRecordsByTag(doc, recordTag);
      usedPath = recordTag;
    } else {
      const preferred = findPreferredRecords(doc);
      const detected = preferred || detectRecords(doc);
      records = detected.elements;
      usedPath = detected.path;
    }

    if (!records.length) {
      return {
        error: "No records found. Try a different record tag.",
        errorType: "no-records",
        usedPath,
      };
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

    return {
      rows,
      columns: computeColumns(rows, simpleView),
      usedPath,
      recordCount: records.length,
    };
  }

  app.computeColumns = computeColumns;
  app.normalizeCellValue = normalizeCellValue;
  app.parseXml = parseXml;
})();
