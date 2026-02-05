(() => {
  const app = window.XmlTable || (window.XmlTable = {});

  const state = {
    xmlText: "",
    currentRows: [],
    currentColumns: [],
    currentFileName: "",
    sortState: { column: "", direction: "asc" },
    groupByBl: true,
    originalRowCount: 0,
    filterState: {},
    groupState: new Map(),
    simpleView: true,
    hideStatusS: true,
    progressState: new Map(),
  };

  function setParsedData(rows, columns) {
    state.currentRows = rows;
    state.currentColumns = columns;
    state.originalRowCount = rows.length;
    state.sortState = { column: "", direction: "asc" };
    state.filterState = {};
    state.groupState = new Map();
    state.progressState = new Map();
  }

  function clearData() {
    state.currentRows = [];
    state.currentColumns = [];
    state.originalRowCount = 0;
    state.sortState = { column: "", direction: "asc" };
    state.filterState = {};
    state.groupState = new Map();
    state.progressState = new Map();
  }

  function resetFilters() {
    state.filterState = {};
  }

  app.state = state;
  app.setParsedData = setParsedData;
  app.clearData = clearData;
  app.resetFilters = resetFilters;
})();
