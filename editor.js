const CELL_SIZE = 24;
const SYMBOL_PADDING = 3;

let currentRows = 20;
let currentCols = 20;
let selectedSymbol = null;
let eraserMode = false;
let placementId = 0;
let isPointerDrawing = false;
let activePointerId = null;
let lastPaintedCellKey = null;

const placements = new Map();
let occupiedCells = new Map();
let symbolsData = [];
let undoStack = [];
let redoStack = [];

function getCellKey(row, col) {
  return `${row}:${col}`;
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

function updateHistoryButtons() {
  document.getElementById("undoBtn").disabled = undoStack.length === 0;
  document.getElementById("redoBtn").disabled = redoStack.length === 0;
}

function resetHistory() {
  undoStack = [];
  redoStack = [];
  updateHistoryButtons();
}

function pushHistoryEntry(entry) {
  undoStack.push(entry);
  redoStack = [];
  updateHistoryButtons();
}

function snapshotPlacements() {
  return Array.from(placements.values()).map((placement) => ({
    id: placement.id,
    row: placement.row,
    col: placement.col,
    symbol: placement.symbol
  }));
}

function clearSelection() {
  document.querySelectorAll(".palette-symbol.selected").forEach((element) => {
    element.classList.remove("selected");
  });
}

function setSelectedSymbol(symbol, element) {
  eraserMode = false;
  document.getElementById("eraserBtn").classList.remove("active");

  selectedSymbol = symbol;
  clearSelection();

  if (element) {
    element.classList.add("selected");
  }
}

function toggleEraser() {
  eraserMode = !eraserMode;
  selectedSymbol = null;
  clearSelection();
  document.getElementById("eraserBtn").classList.toggle("active", eraserMode);
}

function applyBaseBorder(cell, rowNumber, colNumber) {
  cell.style.border = "1px solid #ddd";

  if (colNumber % 5 === 0) cell.style.borderRight = "1px solid #999";
  if (rowNumber % 5 === 0) cell.style.borderTop = "1px solid #999";
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

  currentRows = rows;
  currentCols = cols;
  clearPlacements();
  stopPointerDrawing();

  buildGridShell(rows, cols);
  buildNumberLabels(rows, cols);
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
    if (occupiedCells.has(getCellKey(cell.row, cell.col))) {
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
    pushHistoryEntry({ type: "place", placement: { ...record, cells: record.cells.map((cell) => ({ ...cell })), element: null } });
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
  }

  return snapshot;
}

function restorePlacement(record) {
  if (!record || placements.has(record.id)) return;

  const occupied = record.cells.some((cell) => occupiedCells.has(getCellKey(cell.row, cell.col)));
  if (occupied) return;

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

  if (entry.type === "place") {
    removePlacementById(entry.placement.id, { recordHistory: false });
  } else if (entry.type === "remove") {
    restorePlacement(entry.placement);
  }

  redoStack.push(entry);
  updateHistoryButtons();
}

function redoAction() {
  const entry = redoStack.pop();
  if (!entry) {
    updateHistoryButtons();
    return;
  }

  if (entry.type === "place") {
    restorePlacement(entry.placement);
  } else if (entry.type === "remove") {
    removePlacementById(entry.placement.id, { recordHistory: false });
  }

  undoStack.push(entry);
  updateHistoryButtons();
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName;
  return target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function handleKeydown(event) {
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

  if (cellKey === lastPaintedCellKey) {
    return;
  }

  lastPaintedCellKey = cellKey;
  const occupiedId = occupiedCells.get(cellKey);

  if (eraserMode) {
    if (occupiedId) {
      removePlacementById(occupiedId);
    }
    return;
  }

  if (!selectedSymbol || occupiedId) {
    return;
  }

  placeSymbol(row, col, selectedSymbol);
}

function startPointerDrawing(event) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  if (!eraserMode && !selectedSymbol) {
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

  event.preventDefault();
  paintCell(cell);
}

function continuePointerDrawing(event) {
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

  event.preventDefault();
  paintCell(cell);
}

function stopPointerDrawing(event = null) {
  if (event && activePointerId !== null && event.pointerId !== activePointerId) {
    return;
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

function setupControls() {
  document.getElementById("makeGrid").addEventListener("click", () => {
    const rows = parseInt(document.getElementById("rows").value, 10);
    const cols = parseInt(document.getElementById("cols").value, 10);

    createGrid(rows, cols, { preservePlacements: true, resetHistory: false });
  });

  document.getElementById("undoBtn").addEventListener("click", undoAction);
  document.getElementById("redoBtn").addEventListener("click", redoAction);
  document.getElementById("eraserBtn").addEventListener("click", toggleEraser);
  document.addEventListener("keydown", handleKeydown);

  const gridCells = getGridCells();
  gridCells.addEventListener("pointerdown", startPointerDrawing);
  document.addEventListener("pointermove", continuePointerDrawing);
  document.addEventListener("pointerup", stopPointerDrawing);
  document.addEventListener("pointercancel", stopPointerDrawing);

  updateHistoryButtons();
}

async function init() {
  setupControls();
  setupPaletteToggles();
  createGrid(currentRows, currentCols);
  await loadSymbols();
}

init();