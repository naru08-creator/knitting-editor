// ===============================
// グリッドの基本線（5マスごとに濃い線）
// ===============================
function applyBaseBorder(cell, r, c) {
  // 基本線（薄い）
  cell.style.border = "1px solid #ddd";

  // 5マスごとに濃い線
  if (c % 5 === 0) cell.style.borderRight = "1px solid #999";
  if (r % 5 === 0) cell.style.borderTop = "1px solid #999";
}

// ===============================
// グリッド生成
// ===============================
function createGrid(rows, cols) {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `repeat(${cols}, 24px)`;
  grid.style.gridTemplateRows = `repeat(${rows}, 24px)`;

  // 下 → 上、右 → 左 の順で生成
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const cell = document.createElement("div");
      cell.classList.add("cell");

      applyBaseBorder(cell, r, c);

      grid.appendChild(cell);
    }
  }

  // ===============================
  // 下の番号（右 → 左）
  // ===============================
  const rowNumbers = document.getElementById("rowNumbers");
  rowNumbers.innerHTML = "";
  rowNumbers.style.gridTemplateColumns = `repeat(${cols}, 24px)`;

  for (let c = cols - 1; c >= 0; c--) {
  const num = document.createElement("div");
  num.textContent = cols - c;
  rowNumbers.appendChild(num);
}

  // ===============================
  // 右の番号（下 → 上）
  // ===============================
  const colNumbers = document.getElementById("colNumbers");
  colNumbers.innerHTML = "";
  colNumbers.style.gridTemplateRows = `repeat(${rows}, 24px)`;

  for (let r = rows - 1; r >= 0; r--) {
  const num = document.createElement("div");
  num.textContent = rows - r;
  colNumbers.appendChild(num);
}
}

// ===============================
// グリッド作成ボタン
// ===============================
document.getElementById("makeGrid").addEventListener("click", () => {
  const rows = parseInt(document.getElementById("rows").value);
  const cols = parseInt(document.getElementById("cols").value);

  createGrid(rows, cols);
});

// 初期表示
createGrid(20, 20);
