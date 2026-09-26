import type { DashboardAggregates, LabelledOutput } from "./types.js";
import { renderCard, renderCrossTab, renderFlagCounts, renderNote, renderSeries, renderStats } from "./render.js";
import { validatePayload } from "./validate.js";

const DATA_URL = "./data/aggregates.SYNTHETIC.json";

async function loadAggregates(): Promise<LabelledOutput<DashboardAggregates>> {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`failed to load ${DATA_URL}: ${response.status}`);
  }
  return validatePayload(await response.json());
}

function renderAsOf(container: HTMLElement, dataAsOf: string): void {
  const el = document.createElement("p");
  el.id = "data-as-of";
  el.textContent = `Data last refreshed: ${dataAsOf} (synthetic — regenerated periodically, never real-time)`;
  container.appendChild(el);
}

function renderError(container: HTMLElement, message: string): void {
  const el = document.createElement("p");
  el.className = "error";
  el.textContent = `Could not load dashboard data: ${message}`;
  container.appendChild(el);
}

async function main() {
  const root = document.getElementById("app");
  if (!root) return;

  try {
    const output = await loadAggregates();
    renderAsOf(root, output.dataAsOf);
    const { abuseTypeByQuarter, abuseTypeByRegion, abuseTypeTotals, outcomeCounts, daysToSafetyPlanByQuarter } = output.data;

    const coalitionSection = document.createElement("section");
    coalitionSection.setAttribute("aria-label", "State coalition");
    root.appendChild(coalitionSection);

    const trendCard = renderCard(
      coalitionSection,
      "Reports by abuse type, by quarter",
      "Which kinds of tech abuse are rising?",
    );
    renderCrossTab(trendCard, abuseTypeByQuarter);

    const regionCard = renderCard(
      coalitionSection,
      "Reports by abuse type, by region",
      "Where is there no support? (A 0 means no reports occurred. “Suppressed” marks a small count, or a value hidden to protect one.)",
    );
    renderCrossTab(regionCard, abuseTypeByRegion);

    const fundersSection = document.createElement("section");
    fundersSection.setAttribute("aria-label", "Funders");
    root.appendChild(fundersSection);

    const outcomesCard = renderCard(
      fundersSection,
      "Outcomes reached",
      "How fast do survivors get a safety plan, and what else gets accomplished?",
    );
    renderFlagCounts(outcomesCard, outcomeCounts);
    renderNote(
      outcomesCard,
      "Note: this v0 does not yet track advocate capacity (how many advocates can now handle a tech-abuse case) — " +
        "that half of the funders' question needs a data source beyond the intake record and is an open item (see docs/DECISIONS.md).",
    );

    const daysCard = renderCard(fundersSection, "Days to safety plan, by quarter", "How fast do survivors get a safety plan?");
    renderStats(daysCard, daysToSafetyPlanByQuarter);

    const legislatorsSection = document.createElement("section");
    legislatorsSection.setAttribute("aria-label", "Legislators");
    root.appendChild(legislatorsSection);

    const totalsCard = renderCard(
      legislatorsSection,
      "Statewide totals by abuse type",
      "What does tech abuse look like in Mississippi, in numbers?",
    );
    renderSeries(totalsCard, abuseTypeTotals);
  } catch (error) {
    renderError(root, error instanceof Error ? error.message : String(error));
  }
}

main();
