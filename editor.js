const CELL_SIZE = 24;
const SYMBOL_PADDING = 3;
const GRID_PADDING = 10;
const NUMBER_GAP = 6;
const NUMBER_FONT = "16px 'Noto Sans JP', sans-serif";
const LIGHT_GRID_COLOR = "#d0d0d0";
const HEAVY_GRID_COLOR = "#999999";

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
let imageCache = new Map();

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

function serializeProject() {
  return {
    version: 1,
    rows: currentRows,
    cols: currentCols,
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

  if (colNumber > 1 && (colNumber - 1) % 5 === 0) cell.style.borderRight = "1px solid #999";
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

async function openProjectFromFile(file) {
  const text = await file.text();
  const project = JSON.parse(text);

  if (!project || typeof project !== "object") {
    throw new Error("JSONファイルの形式が正しくありません。");
  }

  if (!Number.isInteger(project.rows) || !Number.isInteger(project.cols)) {
    throw new Error("行数または列数が不正です。");
  }

  const placementsFromFile = Array.isArray(project.placements) ? project.placements : [];
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

  document.getElementById("rows").value = String(project.rows);
  document.getElementById("cols").value = String(project.cols);

  createGrid(project.rows, project.cols, { preservePlacements: false, resetHistory: true });
  restorePlacementList(normalizedPlacements);
  resetHistory();
}

async function saveProject() {
  const project = serializeProject();
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  downloadBlob(blob, `amizu-chart-${getTimestampSuffix()}.json`);
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
  const iframe = document.createElement("iframe");

  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");

  document.body.appendChild(iframe);

  const printDocument = iframe.contentWindow?.document;
  const printWindow = iframe.contentWindow;

  if (!printDocument || !printWindow) {
    iframe.remove();
    window.print();
    return;
  }

  printDocument.open();
  printDocument.write(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>編み図 印刷</title>
<style>
  body { margin: 0; padding: 24px; display: flex; justify-content: center; align-items: flex-start; background: white; }
  img { max-width: 100%; height: auto; display: block; }
  @page { margin: 12mm; }
</style>
</head>
<body>
  <img id="print-image" src="${dataUrl}" alt="編み図">
</body>
</html>`);
  printDocument.close();

  const image = printDocument.getElementById("print-image");
  const cleanup = () => setTimeout(() => iframe.remove(), 1000);

  printWindow.onafterprint = cleanup;

  const triggerPrint = () => {
    printWindow.focus();
    printWindow.print();
  };

  if (image instanceof printWindow.HTMLImageElement) {
    if (image.complete) {
      triggerPrint();
    } else {
      image.onload = triggerPrint;
      image.onerror = triggerPrint;
    }
  } else {
    triggerPrint();
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