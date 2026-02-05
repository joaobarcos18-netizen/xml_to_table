(() => {
  const app = window.XmlTable || (window.XmlTable = {});
  const { state, normalizeCellValue } = app;

  const EMPTY_TOKEN = "__EMPTY__";

  let elements = {
    tableEl: null,
    metaEl: null,
    summaryEl: null,
  };

  function setTableElements(nextElements) {
    elements = { ...elements, ...nextElements };
  }

  function clearTable(metaText = "No data yet.", summaryText = "Selected BLs: 0") {
    if (elements.tableEl) {
      elements.tableEl.innerHTML = "";
    }
    if (elements.metaEl && metaText != null) {
      elements.metaEl.textContent = metaText;
    }
    if (elements.summaryEl && summaryText != null) {
      elements.summaryEl.textContent = summaryText;
    }
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
    if (!state.hideStatusS) {
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
    const activeColumns = Object.keys(state.filterState).filter(
      (col) => state.filterState[col] && state.filterState[col].size
    );
    if (!activeColumns.length) {
      return rows;
    }
    return rows.filter((row) =>
      activeColumns.every((col) => {
        const selected = state.filterState[col];
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
      label.dataset.sort = state.sortState.column === col ? state.sortState.direction : "";
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
      const activeSet = new Set(state.filterState[col] ? Array.from(state.filterState[col]) : []);

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
            state.filterState[col] = new Set(activeSet);
          } else {
            delete state.filterState[col];
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
        delete state.filterState[col];
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
    const existing = elements.tableEl.querySelector("tbody");
    if (existing) {
      existing.remove();
    }
    elements.tableEl.appendChild(tbody);
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
        state.progressState.set(groupKey, checkbox.checked);
        renderCurrentTable();
      });

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "group-toggle";
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.addEventListener("click", () => {
        state.groupState.set(groupKey, !collapsed);
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
    const buttons = elements.tableEl.querySelectorAll(".th-label");
    buttons.forEach((button) => {
      const column = button.dataset.column;
      button.dataset.sort =
        state.sortState.column === column ? state.sortState.direction : "";
    });
  }

  function closeAllFilters() {
    const filters = elements.tableEl.querySelectorAll("details.th-filter[open]");
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
    if (state.groupState.has(groupKey)) {
      return state.groupState.get(groupKey);
    }
    return true;
  }

  function isGroupChecked(groupKey) {
    if (state.progressState.has(groupKey)) {
      return state.progressState.get(groupKey);
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
    if (!state.currentRows.length) {
      if (elements.tableEl) {
        elements.tableEl.innerHTML = "";
      }
      if (elements.summaryEl) {
        elements.summaryEl.textContent = "Selected BLs: 0";
      }
      return;
    }

    const baseRows = applyStatusFilter(state.currentRows);
    const visibleRows = filterRows(baseRows);
    if (state.groupByBl) {
      let groups = groupRowsByBl(visibleRows);
      if (state.sortState.column) {
        if (state.sortState.column === "BL") {
          groups = sortGroupsByBl(groups, state.sortState.direction);
        } else {
          groups = groups.map((group) => ({
            bl: group.bl,
            rows: sortRows(group.rows, state.sortState.column, state.sortState.direction),
          }));
        }
      }
      renderGroupedBody(groups, state.currentColumns);
    } else {
      const rows = state.sortState.column
        ? sortRows(visibleRows, state.sortState.column, state.sortState.direction)
        : visibleRows;
      renderTableBody(rows, state.currentColumns);
    }

    updateSortIndicators();
    if (elements.summaryEl) {
      elements.summaryEl.textContent = buildSummary(visibleRows);
    }
    if (elements.metaEl) {
      const filteredCount = visibleRows.length;
      if (filteredCount !== state.originalRowCount) {
        elements.metaEl.textContent = `Rows: ${filteredCount} (filtered from ${state.originalRowCount}) | Columns: ${state.currentColumns.length} | File: ${state.currentFileName}`;
      } else {
        elements.metaEl.textContent = `Rows: ${state.originalRowCount} | Columns: ${state.currentColumns.length} | File: ${state.currentFileName}`;
      }
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
    if (!state.currentRows.length) {
      return;
    }
    if (state.sortState.column === column) {
      state.sortState.direction = state.sortState.direction === "asc" ? "desc" : "asc";
    } else {
      state.sortState.column = column;
      state.sortState.direction = "asc";
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

  function renderTable() {
    if (!elements.tableEl) {
      return;
    }
    if (!state.currentRows.length) {
      clearTable();
      return;
    }
    elements.tableEl.innerHTML = "";
    elements.tableEl.appendChild(
      buildTableHeader(state.currentColumns, applyStatusFilter(state.currentRows))
    );
    renderCurrentTable();
  }

  function getVisibleRows() {
    if (!state.currentRows.length) {
      return [];
    }
    return filterRows(applyStatusFilter(state.currentRows));
  }

  app.buildCsv = buildCsv;
  app.clearTable = clearTable;
  app.closeAllFilters = closeAllFilters;
  app.getVisibleRows = getVisibleRows;
  app.renderCurrentTable = renderCurrentTable;
  app.renderTable = renderTable;
  app.setTableElements = setTableElements;
})();
