const CELL_SIZE = 24;
const SYMBOL_PADDING = 3;
const GRID_PADDING = 10;
const NUMBER_GAP = 6;
const NUMBER_FONT = "16px 'Noto Sans JP', sans-serif";
const LIGHT_GRID_COLOR = "#d0d0d0";
const HEAVY_GRID_COLOR = "#999999";
const PALETTE_POSITION_KEY = "amizu-palette-position";
const PENDING_PROJECT_KEY = "amizu-pending-project";
const AUTO_SAVE_KEY = "amizu-auto-save";
const PALETTE_POSITIONS = new Set(["auto", "top", "bottom", "left", "right"]);
const SHAPE_TOOLS = new Set(["disable", "enable"]);

let currentRows = 20;
let currentCols = 20;
let selectedSymbol = null;
let eraserMode = false;
let placementId = 0;
let isPointerDrawing = false;
let activePointerId = null;
let lastPaintedCellKey = null;
let palettePositionPreference = "auto";
let lastSavedSnapshot = "";
let shapeMode = false;
let shapeTool = "disable";
let shapeMirrorEnabled = false;
let patternSelectMode = false;
let patternPasteMode = false;
let patternSelection = null;
let patternSelectionStart = null;
let clipboardPattern = null;
let patternPreviewAnchor = null;
let patternPastePendingTarget = null;
let currentProjectName = "amizu-chart.json";
let currentFileHandle = null;
let autoSaveTimer = null;

const placements = new Map();
let occupiedCells = new Map();
let symbolsData = [];
let undoStack = [];
let redoStack = [];
let shapeUndoStack = [];
let shapeRedoStack = [];
let imageCache = new Map();
let disabledCells = new Set();
let activeShapeBatch = null;
let activeDrawBatch = null;

function getCellKey(row, col) {
  return `${row}:${col}`;
}

function snapshotDisabledCells() {
  return Array.from(disabledCells).map((key) => {
    const [row, col] = key.split(":").map(Number);
    return { row, col };
  });
}

function getPaletteId(symbol) {
  if (symbol.width === 1 && symbol.height === 1) return "palette-1";
  if (symbol.width === 2 && symbol.height === 1) return "palette-w2";
  if (symbol.width === 3 && symbol.height === 1) return "palette-w3";
  if (symbol.width === 4 && symbol.height === 1) return "palette-w4";
  if (symbol.width === 1 && symbol.height === 2) return "palette-h2";
  if (symbol.width === 1 && symbol.height === 3) return "palette-h3";

  return null;
}

function getGridCells() {
  return document.getElementById("grid-cells");
}

function getGridOverlay() {
  return document.getElementById("grid-overlay");
}

function getPatternSelectionBox() {
  return document.getElementById("pattern-selection-box");
}

function getPatternPreviewLayer() {
  return document.getElementById("pattern-preview-layer");
}

function isDirectPasteReleasePointer(event) {
  return event.pointerType !== "mouse";
}

function updateHistoryButtons() {
  document.getElementById("undoBtn").disabled = undoStack.length === 0;
  document.getElementById("redoBtn").disabled = redoStack.length === 0;
  document.getElementById("shapeUndoBtn").disabled = shapeUndoStack.length === 0;
  document.getElementById("shapeRedoBtn").disabled = shapeRedoStack.length === 0;
}

function resetHistory() {
  undoStack = [];
  redoStack = [];
  shapeUndoStack = [];
  shapeRedoStack = [];
  activeShapeBatch = null;
  activeDrawBatch = null;
  updateHistoryButtons();
}

function pushHistoryEntry(entry) {
  undoStack.push(entry);
  redoStack = [];
  updateHistoryButtons();
}

function clonePlacementRecord(record) {
  return {
    id: record.id,
    row: record.row,
    col: record.col,
    symbol: record.symbol,
    cells: record.cells.map((cell) => ({ ...cell })),
    element: null
  };
}

function startDrawBatch() {
  activeDrawBatch = {
    actions: []
  };
}

function recordDrawBatchAction(type, placement) {
  if (!activeDrawBatch || !placement) return;
  activeDrawBatch.actions.push({
    type,
    placement: clonePlacementRecord(placement)
  });
}

function finishDrawBatch() {
  if (!activeDrawBatch) return;

  const { actions } = activeDrawBatch;
  activeDrawBatch = null;

  if (actions.length === 0) {
    return;
  }

  pushHistoryEntry({ type: "batch", actions });
  updateDirtyState();
}

function startShapeBatch() {
  activeShapeBatch = {
    changes: []
  };
}

function recordShapeBatchChange(row, col, previousDisabled, nextDisabled, removedPlacement = null) {
  if (!activeShapeBatch) return;

  const key = getCellKey(row, col);
  const existing = activeShapeBatch.changes.find((change) => change.key === key);
  if (existing) {
    existing.nextDisabled = nextDisabled;
    if (removedPlacement) {
      existing.removedPlacement = removedPlacement;
    }
    return;
  }

  activeShapeBatch.changes.push({
    key,
    row,
    col,
    previousDisabled,
    nextDisabled,
    removedPlacement
  });
}

function finishShapeBatch() {
  if (!activeShapeBatch) return;

  const effectiveChanges = activeShapeBatch.changes.filter((change) => change.previousDisabled !== change.nextDisabled);
  activeShapeBatch = null;

  if (effectiveChanges.length === 0) {
    return;
  }

  shapeUndoStack.push({ changes: effectiveChanges });
  shapeRedoStack = [];
  updateHistoryButtons();
  updateDirtyState();
}

function snapshotPlacements() {
  return Array.from(placements.values()).map((placement) => ({
    id: placement.id,
    row: placement.row,
    col: placement.col,
    symbol: placement.symbol
  }));
}

function serializeProject() {
  return {
    version: 1,
    rows: currentRows,
    cols: currentCols,
    disabledCells: snapshotDisabledCells(),
    placements: snapshotPlacements().map((placement) => ({
      row: placement.row,
      col: placement.col,
      symbol: {
        name: placement.symbol.name,
        file: placement.symbol.file,
        width: placement.symbol.width,
        height: placement.symbol.height
      }
    }))
  };
}

function getTimestampSuffix() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function updateDirtyState() {
  lastSavedSnapshot = lastSavedSnapshot || JSON.stringify(serializeProject());
  const currentSnapshot = JSON.stringify(serializeProject());
  const isDirty = currentSnapshot !== lastSavedSnapshot;
  document.body.dataset.dirty = String(isDirty);
  if (isDirty) {
    scheduleAutoSave();
  }
}

function markSavedState() {
  lastSavedSnapshot = JSON.stringify(serializeProject());
  document.body.dataset.dirty = "false";
}

function hasUnsavedChanges() {
  return document.body.dataset.dirty === "true";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveWithFileHandle(blob) {
  if (!currentFileHandle) {
    return false;
  }

  const writable = await currentFileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

async function saveWithPicker(blob) {
  if (typeof window.showSaveFilePicker !== "function") {
    return false;
  }

  const handle = await window.showSaveFilePicker({
    suggestedName: currentProjectName,
    types: [
      {
        description: "JSON Files",
        accept: {
          "application/json": [".json"]
        }
      }
    ]
  });

  currentFileHandle = handle;
  currentProjectName = handle.name || currentProjectName;
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

function clearAutoSaveTimer() {
  if (autoSaveTimer !== null) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

function writeAutoSave() {
  localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(serializeProject()));
  markSavedState();
}

function scheduleAutoSave() {
  clearAutoSaveTimer();
  autoSaveTimer = window.setTimeout(() => {
    writeAutoSave();
    autoSaveTimer = null;
  }, 250);
}

function clearAutoSave() {
  clearAutoSaveTimer();
  localStorage.removeItem(AUTO_SAVE_KEY);
}

function clearSelection() {
  document.querySelectorAll(".palette-symbol.selected").forEach((element) => {
    element.classList.remove("selected");
  });
}

function clearPatternSelection() {
  patternSelection = null;
  patternSelectionStart = null;
  const box = getPatternSelectionBox();
  box.hidden = true;
  box.style.left = "";
  box.style.top = "";
  box.style.width = "";
  box.style.height = "";
}

function clearPatternPreview() {
  patternPreviewAnchor = null;
  patternPastePendingTarget = null;
  getPatternPreviewLayer().innerHTML = "";
}

function updatePatternUiState() {
  document.body.classList.toggle("pattern-paste-mode", patternPasteMode);
  const touchPatternBtn = document.getElementById("touchPatternBtn");
  if (touchPatternBtn) {
    touchPatternBtn.classList.toggle("active", patternSelectMode || patternPasteMode);
  }
  if (!patternPasteMode) {
    clearPatternPreview();
  }
}

function deactivatePatternModes(options = {}) {
  patternSelectMode = false;
  patternPasteMode = false;
  if (options.clearSelection !== false) {
    clearPatternSelection();
  }
  updatePatternUiState();
}

function setPatternSelectMode(active) {
  patternSelectMode = active;
  patternPasteMode = false;
  if (patternSelectMode) {
    setShapeMode(false);
    eraserMode = false;
    selectedSymbol = null;
    clearSelection();
    document.getElementById("eraserBtn").classList.remove("active");
  } else if (!active) {
    patternSelectionStart = null;
  }
  updatePatternUiState();
}

function setPatternPasteMode(active) {
  if (active && !clipboardPattern) {
    return;
  }

  patternPasteMode = active;
  patternSelectMode = false;
  if (patternPasteMode) {
    setShapeMode(false);
    eraserMode = false;
    selectedSymbol = null;
    clearSelection();
    document.getElementById("eraserBtn").classList.remove("active");
  }
  updatePatternUiState();
}

function setSelectedSymbol(symbol, element) {
  deactivatePatternModes({ clearSelection: false });
  setShapeMode(false);
  eraserMode = false;
  document.getElementById("eraserBtn").classList.remove("active");

  selectedSymbol = symbol;
  clearSelection();

  if (element) {
    element.classList.add("selected");
  }
}

function toggleEraser() {
  deactivatePatternModes({ clearSelection: false });
  setShapeMode(false);
  eraserMode = !eraserMode;
  selectedSymbol = null;
  clearSelection();
  document.getElementById("eraserBtn").classList.toggle("active", eraserMode);
}

function applyBaseBorder(cell, rowNumber, colNumber) {
  cell.style.border = "1px solid #ddd";

  if (colNumber > 1 && (colNumber - 1) % 5 === 0) cell.style.borderRight = "1px solid #999";
  if (rowNumber % 5 === 0) cell.style.borderTop = "1px solid #999";
}

function getCellElement(row, col) {
  return document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
}

function updateCellDisabledState(row, col) {
  const cell = getCellElement(row, col);
  if (!cell) return;

  cell.classList.toggle("disabled", disabledCells.has(getCellKey(row, col)));
}

function setDisabledCell(row, col, disabled, options = {}) {
  if (row < 1 || row > currentRows || col < 1 || col > currentCols) return;

  const key = getCellKey(row, col);
  const isAlreadyDisabled = disabledCells.has(key);
  let removedPlacement = null;

  if (disabled === isAlreadyDisabled) {
    return;
  }

  if (disabled) {
    const occupiedId = occupiedCells.get(key);
    if (occupiedId) {
      removedPlacement = removePlacementById(occupiedId, { recordHistory: false });
    }
    disabledCells.add(key);
  } else {
    disabledCells.delete(key);
  }

  updateCellDisabledState(row, col);

  if (options.recordBatch !== false) {
    recordShapeBatchChange(row, col, isAlreadyDisabled, disabled, removedPlacement);
  }

  if (options.recordHistory !== false) {
    updateDirtyState();
  }
}

function getMirroredCols(col) {
  const mirroredCol = currentCols - col + 1;
  return mirroredCol === col ? [col] : [col, mirroredCol];
}

function applyShapeEdit(row, col) {
  const targetCols = shapeMirrorEnabled ? getMirroredCols(col) : [col];
  const shouldDisable = shapeTool === "disable";

  targetCols.forEach((targetCol) => {
    setDisabledCell(row, targetCol, shouldDisable);
  });
}

function applyShapeHistoryChanges(changes, useNextState) {
  changes.forEach((change) => {
    const targetDisabled = useNextState ? change.nextDisabled : change.previousDisabled;

    setDisabledCell(change.row, change.col, targetDisabled, {
      recordHistory: false,
      recordBatch: false
    });

    if (!targetDisabled && change.removedPlacement) {
      restorePlacement(change.removedPlacement);
    }
  });
  updateDirtyState();
}

function undoShapeAction() {
  const entry = shapeUndoStack.pop();
  if (!entry) {
    updateHistoryButtons();
    return;
  }

  applyShapeHistoryChanges(entry.changes, false);
  shapeRedoStack.push(entry);
  updateHistoryButtons();
}

function redoShapeAction() {
  const entry = shapeRedoStack.pop();
  if (!entry) {
    updateHistoryButtons();
    return;
  }

  applyShapeHistoryChanges(entry.changes, true);
  shapeUndoStack.push(entry);
  updateHistoryButtons();
}

function updateShapeControlsUI() {
  document.body.classList.toggle("shape-mode", shapeMode);
  document.getElementById("shapeModeBtn").classList.toggle("active", shapeMode);
  document.getElementById("shapeControls").hidden = !shapeMode;
  document.getElementById("shapeDisableBtn").classList.toggle("active", shapeTool === "disable");
  document.getElementById("shapeEnableBtn").classList.toggle("active", shapeTool === "enable");
  document.getElementById("shapeMirrorToggle").checked = shapeMirrorEnabled;
}

function setShapeMode(active) {
  if (active) {
    deactivatePatternModes({ clearSelection: false });
  }
  shapeMode = active;
  if (shapeMode) {
    eraserMode = false;
    document.getElementById("eraserBtn").classList.remove("active");
  }
  updateShapeControlsUI();
}

function setShapeTool(nextTool) {
  if (!SHAPE_TOOLS.has(nextTool)) return;
  shapeTool = nextTool;
  updateShapeControlsUI();
}

function normalizePatternSelection(startRow, startCol, endRow, endCol) {
  return {
    minRow: Math.min(startRow, endRow),
    maxRow: Math.max(startRow, endRow),
    minCol: Math.min(startCol, endCol),
    maxCol: Math.max(startCol, endCol)
  };
}

function renderPatternSelection() {
  const box = getPatternSelectionBox();
  if (!patternSelection) {
    box.hidden = true;
    return;
  }

  const left = (currentCols - patternSelection.maxCol) * CELL_SIZE + GRID_PADDING;
  const top = (currentRows - patternSelection.maxRow) * CELL_SIZE + GRID_PADDING;
  const width = (patternSelection.maxCol - patternSelection.minCol + 1) * CELL_SIZE;
  const height = (patternSelection.maxRow - patternSelection.minRow + 1) * CELL_SIZE;

  box.hidden = false;
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
}

function updatePatternSelection(cell) {
  if (!patternSelectionStart) return;

  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  patternSelection = normalizePatternSelection(patternSelectionStart.row, patternSelectionStart.col, row, col);
  renderPatternSelection();
  updatePatternUiState();
}

function copyPatternSelection() {
  if (!patternSelection) return;

  const records = Array.from(placements.values())
    .filter((placement) => placement.cells.every((cell) =>
      cell.row >= patternSelection.minRow
      && cell.row <= patternSelection.maxRow
      && cell.col >= patternSelection.minCol
      && cell.col <= patternSelection.maxCol))
    .map((placement) => ({
      rowOffset: placement.row - patternSelection.minRow,
      colOffset: placement.col - patternSelection.minCol,
      symbol: placement.symbol
    }));

  if (records.length === 0) {
    alert("選択範囲の中にコピーできる記号がありません。");
    return;
  }

  clipboardPattern = {
    width: patternSelection.maxCol - patternSelection.minCol + 1,
    height: patternSelection.maxRow - patternSelection.minRow + 1,
    records
  };

  setPatternPasteMode(true);
}

function pastePatternAt(row, col) {
  if (!clipboardPattern) return;

  let pasted = 0;
  let skipped = 0;

  clipboardPattern.records.forEach((record) => {
    const placed = placeSymbol(row + record.rowOffset, col + record.colOffset, record.symbol, {
      recordHistory: false
    });
    if (placed) {
      pasted += 1;
    } else {
      skipped += 1;
    }
  });

  if (skipped > 0) {
    alert(`${pasted}個貼り付けました。${skipped}個は範囲外または配置済みのため貼り付けできませんでした。`);
  }
}

function canPlacePatternRecordAt(row, col, symbol) {
  return Boolean(canPlaceSymbol(row, col, symbol));
}

function renderPatternPreviewAt(row, col) {
  const previewLayer = getPatternPreviewLayer();
  previewLayer.innerHTML = "";
  patternPreviewAnchor = { row, col };
  patternPastePendingTarget = { row, col };

  if (!clipboardPattern) {
    return;
  }

  clipboardPattern.records.forEach((record) => {
    const targetRow = row + record.rowOffset;
    const targetCol = col + record.colOffset;
    const invalid = !canPlacePatternRecordAt(targetRow, targetCol, record.symbol);
    previewLayer.appendChild(createPatternPreviewElement(targetRow, targetCol, record.symbol, invalid));
  });
}

function clearPlacements() {
  placements.forEach((placement) => {
    placement.element.remove();
  });

  placements.clear();
  occupiedCells = new Map();
}

function buildNumberLabels(rows, cols) {
  const rowNumbers = document.getElementById("rowNumbers");
  rowNumbers.innerHTML = "";
  rowNumbers.style.gridTemplateColumns = `repeat(${cols}, ${CELL_SIZE}px)`;

  for (let c = cols; c >= 1; c--) {
    const num = document.createElement("div");
    num.textContent = c;
    rowNumbers.appendChild(num);
  }

  const colNumbers = document.getElementById("colNumbers");
  colNumbers.innerHTML = "";
  colNumbers.style.gridTemplateRows = `repeat(${rows}, ${CELL_SIZE}px)`;

  for (let r = rows; r >= 1; r--) {
    const num = document.createElement("div");
    num.textContent = r;
    colNumbers.appendChild(num);
  }
}

function buildGridShell(rows, cols) {
  const gridCells = getGridCells();
  const gridOverlay = getGridOverlay();

  gridCells.innerHTML = "";
  gridOverlay.innerHTML = "";

  gridCells.style.gridTemplateColumns = `repeat(${cols}, ${CELL_SIZE}px)`;
  gridCells.style.gridTemplateRows = `repeat(${rows}, ${CELL_SIZE}px)`;
  gridCells.style.width = `${cols * CELL_SIZE}px`;
  gridCells.style.height = `${rows * CELL_SIZE}px`;

  gridOverlay.style.width = `${cols * CELL_SIZE}px`;
  gridOverlay.style.height = `${rows * CELL_SIZE}px`;

  for (let rowNumber = rows; rowNumber >= 1; rowNumber--) {
    for (let colNumber = cols; colNumber >= 1; colNumber--) {
      const cell = document.createElement("div");

      cell.classList.add("cell");
      cell.dataset.row = String(rowNumber);
      cell.dataset.col = String(colNumber);

      applyBaseBorder(cell, rowNumber, colNumber);
      cell.classList.toggle("disabled", disabledCells.has(getCellKey(rowNumber, colNumber)));
      gridCells.appendChild(cell);
    }
  }
}

function restorePlacementList(records) {
  records.forEach((record) => {
    placeSymbol(record.row, record.col, record.symbol, {
      id: record.id,
      recordHistory: false
    });
  });
}

function createGrid(rows, cols, options = {}) {
  const preservedPlacements = options.preservePlacements ? snapshotPlacements() : [];
  const preservedDisabledCells = options.preserveDisabledCells ? snapshotDisabledCells() : [];

  currentRows = rows;
  currentCols = cols;
  clearPlacements();
  clearPatternSelection();
  stopPointerDrawing();
  disabledCells = new Set();

  buildGridShell(rows, cols);
  buildNumberLabels(rows, cols);
  preservedDisabledCells.forEach(({ row, col }) => {
    setDisabledCell(row, col, true, { recordHistory: false });
  });
  restorePlacementList(preservedPlacements);

  if (options.resetHistory !== false) {
    resetHistory();
  }
}

function getPlacementCells(row, col, symbol) {
  const cells = [];

  for (let rowOffset = 0; rowOffset < symbol.height; rowOffset++) {
    for (let colOffset = 0; colOffset < symbol.width; colOffset++) {
      const targetRow = row + rowOffset;
      const targetCol = col + colOffset;

      if (targetRow > currentRows || targetCol > currentCols) {
        return null;
      }

      cells.push({ row: targetRow, col: targetCol });
    }
  }

  return cells;
}

function canPlaceSymbol(row, col, symbol) {
  const cells = getPlacementCells(row, col, symbol);

  if (!cells) return null;

  for (const cell of cells) {
    const key = getCellKey(cell.row, cell.col);
    if (disabledCells.has(key) || occupiedCells.has(key)) {
      return null;
    }
  }

  return cells;
}

function createSymbolElement(row, col, symbol) {
  const element = document.createElement("div");
  const left = (currentCols - (col + symbol.width - 1)) * CELL_SIZE + SYMBOL_PADDING;
  const top = (currentRows - (row + symbol.height - 1)) * CELL_SIZE + SYMBOL_PADDING;
  const width = symbol.width * CELL_SIZE - SYMBOL_PADDING * 2;
  const height = symbol.height * CELL_SIZE - SYMBOL_PADDING * 2;

  element.className = "placed-symbol";
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  element.style.backgroundImage = `url("symbols/${symbol.file}")`;
  element.setAttribute("aria-label", symbol.name || symbol.file);

  return element;
}

function createPatternPreviewElement(row, col, symbol, invalid) {
  const element = createSymbolElement(row, col, symbol);
  element.className = `pattern-preview-symbol${invalid ? " invalid" : ""}`;
  return element;
}

function renderPlacement(record) {
  const element = createSymbolElement(record.row, record.col, record.symbol);
  record.element = element;
  getGridOverlay().appendChild(element);
  placements.set(record.id, record);

  record.cells.forEach((cell) => {
    occupiedCells.set(getCellKey(cell.row, cell.col), record.id);
  });
}

function placeSymbol(row, col, symbol, options = {}) {
  const cells = canPlaceSymbol(row, col, symbol);

  if (!cells) return null;

  const record = {
    id: options.id ?? `placement-${placementId++}`,
    row,
    col,
    symbol,
    cells,
    element: null
  };

  renderPlacement(record);

  if (options.recordHistory !== false) {
    pushHistoryEntry({ type: "place", placement: clonePlacementRecord(record) });
    updateDirtyState();
  }

  if (options.recordBatch !== false) {
    recordDrawBatchAction("place", record);
  }

  return record;
}

function removePlacementById(id, options = {}) {
  const placement = placements.get(id);

  if (!placement) return null;

  const snapshot = {
    id: placement.id,
    row: placement.row,
    col: placement.col,
    symbol: placement.symbol,
    cells: placement.cells.map((cell) => ({ ...cell })),
    element: null
  };

  placement.element.remove();
  placement.cells.forEach((cell) => {
    occupiedCells.delete(getCellKey(cell.row, cell.col));
  });

  placements.delete(id);

  if (options.recordHistory !== false) {
    pushHistoryEntry({ type: "remove", placement: snapshot });
    updateDirtyState();
  }

  if (options.recordBatch !== false) {
    recordDrawBatchAction("remove", snapshot);
  }

  return snapshot;
}

function restorePlacement(record) {
  if (!record || placements.has(record.id)) return;

  const blocked = record.cells.some((cell) => {
    const key = getCellKey(cell.row, cell.col);
    return disabledCells.has(key) || occupiedCells.has(key);
  });
  if (blocked) return;

  const restored = {
    id: record.id,
    row: record.row,
    col: record.col,
    symbol: record.symbol,
    cells: record.cells.map((cell) => ({ ...cell })),
    element: null
  };

  renderPlacement(restored);
}

function undoAction() {
  const entry = undoStack.pop();
  if (!entry) {
    updateHistoryButtons();
    return;
  }

  if (entry.type === "batch") {
    [...entry.actions].reverse().forEach((action) => {
      if (action.type === "place") {
        removePlacementById(action.placement.id, { recordHistory: false, recordBatch: false });
      } else if (action.type === "remove") {
        restorePlacement(action.placement);
      }
    });
  } else if (entry.type === "place") {
    removePlacementById(entry.placement.id, { recordHistory: false });
  } else if (entry.type === "remove") {
    restorePlacement(entry.placement);
  }

  redoStack.push(entry);
  updateHistoryButtons();
  updateDirtyState();
}

function redoAction() {
  const entry = redoStack.pop();
  if (!entry) {
    updateHistoryButtons();
    return;
  }

  if (entry.type === "batch") {
    entry.actions.forEach((action) => {
      if (action.type === "place") {
        restorePlacement(action.placement);
      } else if (action.type === "remove") {
        removePlacementById(action.placement.id, { recordHistory: false, recordBatch: false });
      }
    });
  } else if (entry.type === "place") {
    restorePlacement(entry.placement);
  } else if (entry.type === "remove") {
    removePlacementById(entry.placement.id, { recordHistory: false });
  }

  undoStack.push(entry);
  updateHistoryButtons();
  updateDirtyState();
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName;
  return target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    deactivatePatternModes();
    return;
  }

  if (!(event.ctrlKey || event.metaKey) || isEditableTarget(event.target)) {
    return;
  }

  const key = event.key.toLowerCase();

  if (key === "z" && event.shiftKey) {
    event.preventDefault();
    redoAction();
    return;
  }

  if (key === "z") {
    event.preventDefault();
    undoAction();
    return;
  }

  if (key === "y") {
    event.preventDefault();
    redoAction();
  }
}

function getCellFromPoint(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);

  if (!(element instanceof HTMLElement)) return null;
  if (!element.classList.contains("cell")) return null;

  return element;
}

function paintCell(cell) {
  if (!cell) return;

  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  const cellKey = getCellKey(row, col);

  if (patternSelectMode) {
    updatePatternSelection(cell);
    return;
  }

  if (patternPasteMode) {
    if (cellKey === lastPaintedCellKey) {
      return;
    }
    lastPaintedCellKey = cellKey;
    pastePatternAt(row, col);
    return;
  }

  if (cellKey === lastPaintedCellKey) {
    return;
  }

  lastPaintedCellKey = cellKey;
  if (shapeMode) {
    applyShapeEdit(row, col);
    return;
  }

  const occupiedId = occupiedCells.get(cellKey);

  if (eraserMode) {
    if (occupiedId) {
      removePlacementById(occupiedId, { recordHistory: false });
    }
    return;
  }

  if (!selectedSymbol || occupiedId) {
    return;
  }

  placeSymbol(row, col, selectedSymbol, { recordHistory: false });
}

function startPointerDrawing(event) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  const isPatternShortcut = event.ctrlKey && event.altKey;

  if (isPatternShortcut) {
    setPatternSelectMode(true);
  }

  if (!patternSelectMode && !patternPasteMode && !shapeMode && !eraserMode && !selectedSymbol) {
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const cell = target.closest(".cell");
  if (!(cell instanceof HTMLElement)) {
    return;
  }

  isPointerDrawing = true;
  activePointerId = event.pointerId;
  lastPaintedCellKey = null;

  if (patternSelectMode) {
    patternSelectionStart = {
      row: Number(cell.dataset.row),
      col: Number(cell.dataset.col)
    };
    patternSelection = normalizePatternSelection(patternSelectionStart.row, patternSelectionStart.col, patternSelectionStart.row, patternSelectionStart.col);
    renderPatternSelection();
  }

  if (patternPasteMode) {
    renderPatternPreviewAt(Number(cell.dataset.row), Number(cell.dataset.col));
  }

  if (shapeMode) {
    startShapeBatch();
  } else {
    startDrawBatch();
  }

  event.preventDefault();

  if (patternPasteMode && isDirectPasteReleasePointer(event)) {
    return;
  }

  paintCell(cell);
}

function continuePointerDrawing(event) {
  if (patternPasteMode && !isPointerDrawing) {
    const hoverCell = getCellFromPoint(event.clientX, event.clientY);
    if (hoverCell) {
      renderPatternPreviewAt(Number(hoverCell.dataset.row), Number(hoverCell.dataset.col));
    } else {
      clearPatternPreview();
    }
    return;
  }

  if (!isPointerDrawing || event.pointerId !== activePointerId) {
    return;
  }

  if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
    stopPointerDrawing(event);
    return;
  }

  const cell = getCellFromPoint(event.clientX, event.clientY);
  if (!cell) {
    return;
  }

  if (patternPasteMode && isDirectPasteReleasePointer(event)) {
    event.preventDefault();
    renderPatternPreviewAt(Number(cell.dataset.row), Number(cell.dataset.col));
    return;
  }

  event.preventDefault();
  paintCell(cell);
}

function stopPointerDrawing(event = null) {
  if (event && activePointerId !== null && event.pointerId !== activePointerId) {
    return;
  }

  if (patternPasteMode && event && isDirectPasteReleasePointer(event) && patternPastePendingTarget) {
    pastePatternAt(patternPastePendingTarget.row, patternPastePendingTarget.col);
  }

  if (shapeMode) {
    finishShapeBatch();
  } else {
    finishDrawBatch();
  }

  if (patternSelectMode) {
    copyPatternSelection();
    patternSelectMode = false;
    patternSelectionStart = null;
    updatePatternUiState();
  }

  isPointerDrawing = false;
  activePointerId = null;
  lastPaintedCellKey = null;
}

function createPaletteItem(symbol) {
  const button = document.createElement("button");
  const image = document.createElement("img");

  button.type = "button";
  button.className = "palette-symbol";
  button.title = symbol.name || symbol.file;

  image.src = `symbols/${symbol.file}`;
  image.alt = symbol.name || symbol.file;

  button.appendChild(image);
  button.addEventListener("click", () => {
    setSelectedSymbol(symbol, button);
  });

  return button;
}

function buildPalettes(symbols) {
  const paletteIds = [
    "palette-1",
    "palette-w2",
    "palette-w3",
    "palette-w4",
    "palette-h2",
    "palette-h3"
  ];

  paletteIds.forEach((id) => {
    document.getElementById(id).innerHTML = "";
  });

  symbols.forEach((symbol) => {
    const paletteId = getPaletteId(symbol);

    if (!paletteId) return;

    const palette = document.getElementById(paletteId);
    palette.appendChild(createPaletteItem(symbol));
  });
}

function setupPaletteToggles() {
  document.querySelectorAll(".toggle-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.target;
      const target = document.getElementById(targetId);
      const isOpen = target.classList.toggle("open");

      button.classList.toggle("open", isOpen);
    });
  });
}

function getAutoPalettePosition() {
  return window.innerWidth > window.innerHeight ? "right" : "bottom";
}

function applyPalettePosition() {
  const resolved = palettePositionPreference === "auto" ? getAutoPalettePosition() : palettePositionPreference;
  document.body.dataset.palettePosition = resolved;
}

function closeSettingsPanel() {
  const settingsPanel = document.getElementById("settingsPanel");
  const settingsBtn = document.getElementById("settingsBtn");

  settingsPanel.hidden = true;
  settingsBtn.setAttribute("aria-expanded", "false");
}

function toggleSettingsPanel() {
  const settingsPanel = document.getElementById("settingsPanel");
  const settingsBtn = document.getElementById("settingsBtn");
  const nextHidden = !settingsPanel.hidden;

  settingsPanel.hidden = nextHidden;
  settingsBtn.setAttribute("aria-expanded", String(!nextHidden));
}

function setPalettePositionPreference(value) {
  const nextValue = PALETTE_POSITIONS.has(value) ? value : "auto";
  palettePositionPreference = nextValue;
  localStorage.setItem(PALETTE_POSITION_KEY, nextValue);
  document.getElementById("palettePositionSelect").value = nextValue;
  applyPalettePosition();
}

function loadPalettePositionPreference() {
  const saved = localStorage.getItem(PALETTE_POSITION_KEY);
  palettePositionPreference = PALETTE_POSITIONS.has(saved) ? saved : "auto";
  document.getElementById("palettePositionSelect").value = palettePositionPreference;
  applyPalettePosition();
}

function handleDocumentClick(event) {
  const settingsPanel = document.getElementById("settingsPanel");
  const settingsBtn = document.getElementById("settingsBtn");
  const target = event.target;

  if (!(target instanceof Node)) {
    return;
  }

  if (settingsPanel.hidden) {
    return;
  }

  if (settingsPanel.contains(target) || settingsBtn.contains(target)) {
    return;
  }

  closeSettingsPanel();
}

function setupPaletteSettings() {
  const settingsBtn = document.getElementById("settingsBtn");
  const palettePositionSelect = document.getElementById("palettePositionSelect");

  loadPalettePositionPreference();

  settingsBtn.addEventListener("click", () => {
    toggleSettingsPanel();
  });

  palettePositionSelect.addEventListener("change", (event) => {
    setPalettePositionPreference(event.target.value);
  });

  window.addEventListener("resize", () => {
    if (palettePositionPreference === "auto") {
      applyPalettePosition();
    }
  });

  window.addEventListener("orientationchange", () => {
    if (palettePositionPreference === "auto") {
      applyPalettePosition();
    }
  });

  document.addEventListener("click", handleDocumentClick);
}

function setupShapeControls() {
  document.getElementById("shapeModeBtn").addEventListener("click", () => {
    setShapeMode(!shapeMode);
  });

  document.getElementById("shapeDisableBtn").addEventListener("click", () => {
    setShapeTool("disable");
  });

  document.getElementById("shapeEnableBtn").addEventListener("click", () => {
    setShapeTool("enable");
  });

  document.getElementById("shapeUndoBtn").addEventListener("click", undoShapeAction);
  document.getElementById("shapeRedoBtn").addEventListener("click", redoShapeAction);

  document.getElementById("shapeMirrorToggle").addEventListener("change", (event) => {
    shapeMirrorEnabled = event.target.checked;
    updateShapeControlsUI();
  });

  updateShapeControlsUI();
}

function setupTouchPatternControls() {
  const isTouchDevice = navigator.maxTouchPoints > 0;
  document.body.classList.toggle("touch-device", isTouchDevice);

  if (!isTouchDevice) {
    return;
  }

  document.getElementById("touchPatternBtn").addEventListener("click", () => {
    if (patternSelectMode || patternPasteMode) {
      deactivatePatternModes();
      return;
    }

    setPatternSelectMode(true);
  });
}

async function loadSymbols() {
  const embedded = window.SYMBOLS_DATA;

  if (embedded && typeof embedded === "object") {
    symbolsData = Object.values(embedded).flat();
    buildPalettes(symbolsData);
    return;
  }

  try {
    const response = await fetch("data/symbols.json?v=20260404-3", { cache: "no-store" });
    const data = await response.json();

    symbolsData = Object.values(data).flat();
    buildPalettes(symbolsData);
  } catch (error) {
    console.error("記号データを読み込めませんでした", error);
  }
}

function getSymbolImage(symbolFile) {
  if (imageCache.has(symbolFile)) {
    return imageCache.get(symbolFile);
  }

  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`画像を読み込めませんでした: ${symbolFile}`));
    image.src = `symbols/${symbolFile}`;
  });

  imageCache.set(symbolFile, promise);
  return promise;
}

async function drawChartToCanvas() {
  const gridWidth = currentCols * CELL_SIZE;
  const gridHeight = currentRows * CELL_SIZE;
  const bottomNumberHeight = CELL_SIZE + NUMBER_GAP + 8;
  const rightNumberWidth = CELL_SIZE + NUMBER_GAP + 8;
  const canvas = document.createElement("canvas");
  const width = GRID_PADDING * 2 + gridWidth + rightNumberWidth;
  const height = GRID_PADDING * 2 + gridHeight + bottomNumberHeight;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  const gridLeft = GRID_PADDING;
  const gridTop = GRID_PADDING;
  const gridRight = gridLeft + gridWidth;
  const gridBottom = gridTop + gridHeight;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  snapshotDisabledCells().forEach(({ row, col }) => {
    const x = gridRight - col * CELL_SIZE;
    const y = gridBottom - row * CELL_SIZE;
    ctx.fillStyle = "#e1e7eb";
    ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
  });

  const placementsToDraw = snapshotPlacements();
  const symbolImages = await Promise.all(
    placementsToDraw.map(async (placement) => ({
      placement,
      image: await getSymbolImage(placement.symbol.file)
    }))
  );

  for (const { placement, image } of symbolImages) {
    const x = gridLeft + (currentCols - (placement.col + placement.symbol.width - 1)) * CELL_SIZE + SYMBOL_PADDING;
    const y = gridTop + (currentRows - (placement.row + placement.symbol.height - 1)) * CELL_SIZE + SYMBOL_PADDING;
    const w = placement.symbol.width * CELL_SIZE - SYMBOL_PADDING * 2;
    const h = placement.symbol.height * CELL_SIZE - SYMBOL_PADDING * 2;
    ctx.drawImage(image, x, y, w, h);
  }

  for (let row = 1; row <= currentRows; row++) {
    const y = gridBottom - row * CELL_SIZE;
    for (let col = 1; col <= currentCols; col++) {
      const x = gridRight - col * CELL_SIZE;
      ctx.strokeStyle = LIGHT_GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, CELL_SIZE, CELL_SIZE);
    }
  }

  ctx.strokeStyle = HEAVY_GRID_COLOR;
  ctx.lineWidth = 1;

  for (let row = 5; row <= currentRows; row += 5) {
    const y = gridBottom - row * CELL_SIZE + 0.5;
    ctx.beginPath();
    ctx.moveTo(gridLeft, y);
    ctx.lineTo(gridRight, y);
    ctx.stroke();
  }

  for (let col = 6; col <= currentCols; col += 5) {
    const x = gridRight - (col - 1) * CELL_SIZE + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, gridTop);
    ctx.lineTo(x, gridBottom);
    ctx.stroke();
  }

  ctx.font = NUMBER_FONT;
  ctx.fillStyle = "#333333";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let col = currentCols; col >= 1; col--) {
    const x = gridRight - (col - 0.5) * CELL_SIZE;
    const y = gridBottom + NUMBER_GAP + CELL_SIZE / 2;
    ctx.fillText(String(col), x, y);
  }

  for (let row = currentRows; row >= 1; row--) {
    const x = gridRight + NUMBER_GAP + CELL_SIZE / 2;
    const y = gridBottom - (row - 0.5) * CELL_SIZE;
    ctx.fillText(String(row), x, y);
  }

  return canvas;
}

function normalizeProject(project) {
  if (!project || typeof project !== "object") {
    throw new Error("JSONファイルの形式が正しくありません。");
  }

  if (!Number.isInteger(project.rows) || !Number.isInteger(project.cols)) {
    throw new Error("行数または列数が不正です。");
  }

  const placementsFromFile = Array.isArray(project.placements) ? project.placements : [];
  const disabledFromFile = Array.isArray(project.disabledCells) ? project.disabledCells : [];
  const normalizedPlacements = placementsFromFile
    .filter((placement) => placement && placement.symbol)
    .map((placement) => ({
      id: `placement-${placementId++}`,
      row: Number(placement.row),
      col: Number(placement.col),
      symbol: {
        name: placement.symbol.name || placement.symbol.file,
        file: placement.symbol.file,
        width: Number(placement.symbol.width),
        height: Number(placement.symbol.height)
      }
    }))
    .filter((placement) => Number.isInteger(placement.row)
      && Number.isInteger(placement.col)
      && placement.symbol.file
      && Number.isInteger(placement.symbol.width)
      && Number.isInteger(placement.symbol.height));
  const normalizedDisabledCells = disabledFromFile
    .map((cell) => ({
      row: Number(cell?.row),
      col: Number(cell?.col)
    }))
    .filter((cell) => Number.isInteger(cell.row) && Number.isInteger(cell.col));

  return {
    rows: project.rows,
    cols: project.cols,
    disabledCells: normalizedDisabledCells,
    placements: normalizedPlacements
  };
}

function loadProject(project) {
  const normalizedProject = normalizeProject(project);

  document.getElementById("rows").value = String(normalizedProject.rows);
  document.getElementById("cols").value = String(normalizedProject.cols);

  createGrid(normalizedProject.rows, normalizedProject.cols, {
    preservePlacements: false,
    preserveDisabledCells: false,
    resetHistory: true
  });
  normalizedProject.disabledCells.forEach(({ row, col }) => {
    setDisabledCell(row, col, true, { recordHistory: false });
  });
  restorePlacementList(normalizedProject.placements);
  resetHistory();
  markSavedState();
  localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(serializeProject()));
}

async function openProjectFromFile(file) {
  const text = await file.text();
  const project = JSON.parse(text);
  currentProjectName = file.name || currentProjectName;
  currentFileHandle = null;
  loadProject(project);
}

function loadPendingProjectFromSession() {
  const raw = sessionStorage.getItem(PENDING_PROJECT_KEY);
  if (!raw) return false;

  sessionStorage.removeItem(PENDING_PROJECT_KEY);

  try {
    const project = JSON.parse(raw);
    loadProject(project);
    return true;
  } catch (error) {
    console.error(error);
    alert(error instanceof Error ? error.message : "保存データを読み込めませんでした。");
    return false;
  }
}

function loadAutoSavedProject() {
  const raw = localStorage.getItem(AUTO_SAVE_KEY);
  if (!raw) return false;

  try {
    const project = JSON.parse(raw);
    loadProject(project);
    return true;
  } catch (error) {
    console.error(error);
    localStorage.removeItem(AUTO_SAVE_KEY);
    return false;
  }
}

async function saveProject() {
  const project = serializeProject();
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const saved =
    await saveWithFileHandle(blob).catch(() => false)
    || await saveWithPicker(blob).catch(() => false);

  if (!saved) {
    downloadBlob(blob, currentProjectName || `amizu-chart-${getTimestampSuffix()}.json`);
  }
}

async function exportPng() {
  const canvas = await drawChartToCanvas();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  downloadBlob(blob, `amizu-chart-${getTimestampSuffix()}.png`);
}

async function printChart() {
  const canvas = await drawChartToCanvas();
  const dataUrl = canvas.toDataURL("image/png");
  const printArea = document.getElementById("printArea");
  const image = document.createElement("img");

  image.src = dataUrl;
  image.alt = "編み図";

  printArea.innerHTML = "";
  printArea.appendChild(image);
  document.body.classList.add("printing-chart");

  const cleanup = () => {
    document.body.classList.remove("printing-chart");
    printArea.innerHTML = "";
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);

  await new Promise((resolve) => {
    if (image.complete) {
      resolve();
      return;
    }

    image.onload = () => resolve();
    image.onerror = () => resolve();
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
    });
  });
}

function setupControls() {
  document.getElementById("makeGrid").addEventListener("click", () => {
    const rows = parseInt(document.getElementById("rows").value, 10);
    const cols = parseInt(document.getElementById("cols").value, 10);

    const sizeChanged = rows !== currentRows || cols !== currentCols;
    createGrid(rows, cols, {
      preservePlacements: true,
      preserveDisabledCells: true,
      resetHistory: false
    });
    if (sizeChanged) {
      updateDirtyState();
    }
  });

  document.getElementById("undoBtn").addEventListener("click", undoAction);
  document.getElementById("redoBtn").addEventListener("click", redoAction);
  document.getElementById("eraserBtn").addEventListener("click", toggleEraser);
  document.getElementById("homeBtn").addEventListener("click", () => {
    if (hasUnsavedChanges()) {
      writeAutoSave();
    }
    window.location.href = "index.html";
  });
  document.getElementById("openBtn").addEventListener("click", () => {
    document.getElementById("openFileInput").click();
  });
  document.getElementById("openFileInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await openProjectFromFile(file);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "ファイルを読み込めませんでした。");
    } finally {
      event.target.value = "";
    }
  });
  document.getElementById("saveBtn").addEventListener("click", () => {
    saveProject().catch((error) => console.error(error));
  });
  document.getElementById("pngBtn").addEventListener("click", () => {
    exportPng().catch((error) => console.error(error));
  });
  document.getElementById("printBtn").addEventListener("click", () => {
    printChart().catch((error) => console.error(error));
  });
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("beforeunload", () => {
    if (hasUnsavedChanges()) {
      writeAutoSave();
    }
  });

  const gridCells = getGridCells();
  gridCells.addEventListener("pointerdown", startPointerDrawing);
  document.addEventListener("pointermove", continuePointerDrawing);
  document.addEventListener("pointerup", stopPointerDrawing);
  document.addEventListener("pointercancel", stopPointerDrawing);

  updateHistoryButtons();
  updatePatternUiState();
}

async function init() {
  setupControls();
  setupShapeControls();
  setupTouchPatternControls();
  setupPaletteSettings();
  setupPaletteToggles();
  createGrid(currentRows, currentCols);
  markSavedState();
  const loadedPendingProject = loadPendingProjectFromSession();
  const loadedAutoSavedProject = loadedPendingProject ? false : loadAutoSavedProject();
  await loadSymbols();

  if (loadedPendingProject || loadedAutoSavedProject) {
    clearSelection();
  }
}

init();







