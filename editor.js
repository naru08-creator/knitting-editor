const CELL_SIZE = 24;

let currentRows = 20;
let currentCols = 20;
let selectedSymbol = null;
let eraserMode = false;
let placementId = 0;

const placements = new Map();
let occupiedCells = new Map();
let symbolsData = [];

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

function applyBaseBorder(cell, r, c) {
  cell.style.border = "1px solid #ddd";

  if (c % 5 === 0) cell.style.borderRight = "1px solid #999";
  if (r % 5 === 0) cell.style.borderTop = "1px solid #999";
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

  for (let c = cols - 1; c >= 0; c--) {
    const num = document.createElement("div");
    num.textContent = c + 1;
    rowNumbers.appendChild(num);
  }

  const colNumbers = document.getElementById("colNumbers");
  colNumbers.innerHTML = "";
  colNumbers.style.gridTemplateRows = `repeat(${rows}, ${CELL_SIZE}px)`;

  for (let r = rows - 1; r >= 0; r--) {
    const num = document.createElement("div");
    num.textContent = r + 1;
    colNumbers.appendChild(num);
  }
}

function createGrid(rows, cols) {
  currentRows = rows;
  currentCols = cols;
  clearPlacements();

  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `repeat(${cols}, ${CELL_SIZE}px)`;
  grid.style.gridTemplateRows = `repeat(${rows}, ${CELL_SIZE}px)`;
  grid.style.width = `${cols * CELL_SIZE}px`;
  grid.style.height = `${rows * CELL_SIZE}px`;

  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const cell = document.createElement("div");
      const row = r + 1;
      const col = c + 1;

      cell.classList.add("cell");
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);

      applyBaseBorder(cell, r, c);
      cell.addEventListener("click", handleCellClick);

      grid.appendChild(cell);
    }
  }

  buildNumberLabels(rows, cols);
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
  const left = (currentCols - (col + symbol.width - 1)) * CELL_SIZE;
  const top = (currentRows - (row + symbol.height - 1)) * CELL_SIZE;

  element.className = "placed-symbol";
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${symbol.width * CELL_SIZE}px`;
  element.style.height = `${symbol.height * CELL_SIZE}px`;
  element.style.backgroundImage = `url("symbols/${symbol.file}")`;
  element.setAttribute("aria-label", symbol.name || symbol.file);

  return element;
}

function placeSymbol(row, col, symbol) {
  const cells = canPlaceSymbol(row, col, symbol);

  if (!cells) return;

  const id = `placement-${placementId++}`;
  const element = createSymbolElement(row, col, symbol);

  document.getElementById("grid").appendChild(element);

  placements.set(id, {
    id,
    row,
    col,
    symbol,
    cells,
    element
  });

  cells.forEach((cell) => {
    occupiedCells.set(getCellKey(cell.row, cell.col), id);
  });
}

function removePlacementById(id) {
  const placement = placements.get(id);

  if (!placement) return;

  placement.element.remove();
  placement.cells.forEach((cell) => {
    occupiedCells.delete(getCellKey(cell.row, cell.col));
  });

  placements.delete(id);
}

function handleCellClick(event) {
  const row = Number(event.currentTarget.dataset.row);
  const col = Number(event.currentTarget.dataset.col);
  const occupiedId = occupiedCells.get(getCellKey(row, col));

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

    createGrid(rows, cols);
  });

  document.getElementById("eraserBtn").addEventListener("click", toggleEraser);
}

async function init() {
  setupControls();
  setupPaletteToggles();
  createGrid(currentRows, currentCols);
  await loadSymbols();
}

init();