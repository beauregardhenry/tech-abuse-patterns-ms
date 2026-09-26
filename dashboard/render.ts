import type { SuppressedFlagCount, SuppressedStat, SuppressedTable } from "./types.js";

function formatCount(value: number | null, threshold: number): string {
  return value === null ? `hidden (<${threshold})` : String(value);
}

export function renderCard(container: HTMLElement, title: string, questionText: string): HTMLElement {
  const card = document.createElement("section");
  card.className = "chart-card";

  const watermark = document.createElement("div");
  watermark.className = "watermark";
  watermark.textContent = "SYNTHETIC DATA";
  card.appendChild(watermark);

  const heading = document.createElement("h2");
  heading.textContent = title;
  card.appendChild(heading);

  const question = document.createElement("p");
  question.className = "question";
  question.textContent = questionText;
  card.appendChild(question);

  container.appendChild(card);
  return card;
}

export function renderCrossTab(card: HTMLElement, table: SuppressedTable): void {
  const el = document.createElement("table");
  el.className = "aggregate-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.appendChild(document.createElement("th"));
  for (const colLabel of table.colLabels) {
    const th = document.createElement("th");
    th.textContent = colLabel;
    headRow.appendChild(th);
  }
  const totalHeader = document.createElement("th");
  totalHeader.textContent = "Total";
  headRow.appendChild(totalHeader);
  thead.appendChild(headRow);
  el.appendChild(thead);

  const tbody = document.createElement("tbody");
  table.rowLabels.forEach((rowLabel, i) => {
    const row = document.createElement("tr");
    const rowHeader = document.createElement("th");
    rowHeader.scope = "row";
    rowHeader.textContent = rowLabel;
    row.appendChild(rowHeader);

    table.colLabels.forEach((_, j) => {
      const td = document.createElement("td");
      td.textContent = formatCount(table.cells[i]![j]!, table.suppressionThreshold);
      row.appendChild(td);
    });

    const totalCell = document.createElement("td");
    totalCell.className = "total-cell";
    totalCell.textContent = formatCount(table.rowTotals[i]!, table.suppressionThreshold);
    row.appendChild(totalCell);

    tbody.appendChild(row);
  });
  el.appendChild(tbody);

  const tfoot = document.createElement("tfoot");
  const totalRow = document.createElement("tr");
  const totalRowHeader = document.createElement("th");
  totalRowHeader.scope = "row";
  totalRowHeader.textContent = "Total";
  totalRow.appendChild(totalRowHeader);
  table.colLabels.forEach((_, j) => {
    const td = document.createElement("td");
    td.className = "total-cell";
    td.textContent = formatCount(table.colTotals[j]!, table.suppressionThreshold);
    totalRow.appendChild(td);
  });
  const grandTotalCell = document.createElement("td");
  grandTotalCell.className = "total-cell";
  grandTotalCell.textContent = formatCount(table.grandTotal, table.suppressionThreshold);
  totalRow.appendChild(grandTotalCell);
  tfoot.appendChild(totalRow);
  el.appendChild(tfoot);

  card.appendChild(el);
}

/** Renders a one-way SuppressedTable (a single "all" column) as a simple label/count list, plus its grand total. */
export function renderSeries(card: HTMLElement, table: SuppressedTable): void {
  const list = document.createElement("dl");
  list.className = "flag-counts";
  table.rowLabels.forEach((label, i) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = formatCount(table.cells[i]![0]!, table.suppressionThreshold);
    list.appendChild(dt);
    list.appendChild(dd);
  });
  const dt = document.createElement("dt");
  dt.className = "total-cell";
  dt.textContent = "Statewide total";
  const dd = document.createElement("dd");
  dd.className = "total-cell";
  dd.textContent = formatCount(table.grandTotal, table.suppressionThreshold);
  list.appendChild(dt);
  list.appendChild(dd);
  card.appendChild(list);
}

export function renderFlagCounts(card: HTMLElement, counts: readonly SuppressedFlagCount[], threshold: number): void {
  const list = document.createElement("dl");
  list.className = "flag-counts";
  for (const { label, count } of counts) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = formatCount(count, threshold);
    list.appendChild(dt);
    list.appendChild(dd);
  }
  card.appendChild(list);
}

export function renderStats(card: HTMLElement, stats: readonly SuppressedStat[], threshold: number): void {
  const el = document.createElement("table");
  el.className = "aggregate-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const text of ["Quarter", "Records measured", "Mean days to safety plan"]) {
    const th = document.createElement("th");
    th.textContent = text;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  el.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const stat of stats) {
    const row = document.createElement("tr");
    const labelCell = document.createElement("th");
    labelCell.scope = "row";
    labelCell.textContent = stat.label;
    row.appendChild(labelCell);

    const nCell = document.createElement("td");
    nCell.textContent = formatCount(stat.n, threshold);
    row.appendChild(nCell);

    const meanCell = document.createElement("td");
    meanCell.textContent = stat.meanDays === null ? "—" : stat.meanDays.toFixed(1);
    row.appendChild(meanCell);

    tbody.appendChild(row);
  }
  el.appendChild(tbody);
  card.appendChild(el);
}

export function renderNote(card: HTMLElement, text: string): void {
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = text;
  card.appendChild(note);
}
