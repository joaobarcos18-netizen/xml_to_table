(() => {
  const app = window.XmlTable || (window.XmlTable = {});
  const {
    state,
    clearData,
    resetFilters,
    setParsedData,
    computeColumns,
    parseXml,
    buildCsv,
    clearTable,
    closeAllFilters,
    getVisibleRows,
    renderCurrentTable,
    renderTable,
    setTableElements,
  } = app;

  function setStatus(statusEl, message, type = "") {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
    statusEl.className = `status ${type}`.trim();
  }

  function initUi() {
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

    setTableElements({ tableEl, metaEl, summaryEl });

    function parseAndRender() {
      const manualTag = recordInput ? recordInput.value.trim() : "";
      const result = parseXml(state.xmlText, {
        recordTag: manualTag,
        simpleView: state.simpleView,
      });

      if (result.error) {
        setStatus(statusEl, result.error, "error");
        if (result.errorType === "no-records") {
          if (detectedEl) {
            detectedEl.textContent = "";
          }
          clearData();
          clearTable();
          if (downloadBtn) {
            downloadBtn.disabled = true;
          }
        }
        return;
      }

      setParsedData(result.rows, result.columns);
      renderTable();
      if (downloadBtn) {
        downloadBtn.disabled = false;
      }
      setStatus(statusEl, `Loaded ${result.recordCount} records.`, "");
      if (detectedEl) {
        detectedEl.textContent = `Record path: ${result.usedPath}`;
      }
    }

    function loadXmlFile(file) {
      if (!file) {
        return;
      }
      state.currentFileName = file.name;
      const reader = new FileReader();
      reader.onload = () => {
        state.xmlText = reader.result;
        setStatus(statusEl, `File loaded: ${file.name}`);
        parseAndRender();
      };
      reader.readAsText(file);
    }

    if (fileInput) {
      fileInput.addEventListener("change", (event) => {
        loadXmlFile(event.target.files[0]);
      });
    }

    if (groupToggle) {
      state.groupByBl = groupToggle.checked;
      groupToggle.addEventListener("change", () => {
        state.groupByBl = groupToggle.checked;
        renderCurrentTable();
      });
    }

    if (simpleViewToggle) {
      state.simpleView = simpleViewToggle.checked;
      simpleViewToggle.addEventListener("change", () => {
        state.simpleView = simpleViewToggle.checked;
        if (state.currentRows.length) {
          resetFilters();
          state.currentColumns = computeColumns(state.currentRows, state.simpleView);
          renderTable();
        }
      });
    }

    if (hideStatusSToggle) {
      state.hideStatusS = hideStatusSToggle.checked;
      hideStatusSToggle.addEventListener("change", () => {
        state.hideStatusS = hideStatusSToggle.checked;
        if (state.currentRows.length) {
          resetFilters();
          renderTable();
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

    if (parseBtn) {
      parseBtn.addEventListener("click", () => {
        parseAndRender();
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => {
        const visibleRows = getVisibleRows();
        if (!visibleRows.length) {
          return;
        }
        const csv = buildCsv(visibleRows, state.currentColumns);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const base = state.currentFileName
          ? state.currentFileName.replace(/\.[^.]+$/, "")
          : "table";
        link.href = url;
        link.download = `${base}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
    }
  }

  app.initUi = initUi;
})();
