import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { parseCsv } from "../src/lib/csv";
import { POLICY_V5_DEFAULT } from "../src/engine/defaultPolicy";
import { runDecisionEngine } from "../src/engine/decisionEngine";
import { buildPreferredSuppliersForItem } from "../src/engine/preferredSuppliers";
import { matchItem } from "../src/engine/itemMatcher";
import { PolicyConfig } from "../src/engine/types";

const dataDir = path.join(process.cwd(), "data");

function loadData() {
  const items = parseCsv(fs.readFileSync(path.join(dataDir, "item_master.csv"), "utf-8")).map((r) => ({
    itemCode: r.item_code,
    description: r.description,
    uom: r.uom,
    category: r.category,
    itemType: r.item_type,
    standardPrice: parseFloat(r.standard_price),
  }));

  const suppliers = parseCsv(fs.readFileSync(path.join(dataDir, "supplier_master.csv"), "utf-8")).map((r) => ({
    supplierId: r.supplier_id,
    name: r.name,
    city: r.city,
    categories: r.categories,
    status: r.status,
    onTimePct: parseFloat(r.on_time_pct),
    qualityRating: parseFloat(r.quality_rating),
  }));

  const poHistory = parseCsv(fs.readFileSync(path.join(dataDir, "po_history.csv"), "utf-8")).map((r) => ({
    poNumber: r.po_number,
    poDate: r.po_date,
    supplierId: r.supplier_id,
    itemCode: r.item_code,
    quantity: parseFloat(r.quantity),
    uom: r.uom,
    unitPrice: parseFloat(r.unit_price),
    plant: r.plant,
    deliveredOnTime: r.delivered_on_time.toLowerCase() === "true",
  }));

  const contracts = parseCsv(fs.readFileSync(path.join(dataDir, "contract_register.csv"), "utf-8")).map((r) => ({
    contractId: r.contract_id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    startDate: r.start_date,
    endDate: r.end_date,
    valueCap: parseFloat(r.value_cap),
    consumedValue: parseFloat(r.consumed_value),
  }));

  const contractLines = parseCsv(fs.readFileSync(path.join(dataDir, "contract_lines.csv"), "utf-8")).map((r) => ({
    contractId: r.contract_id,
    itemCode: r.item_code,
    description: r.description,
    uom: r.uom,
    rate: parseFloat(r.rate),
  }));

  const prLines = parseCsv(fs.readFileSync(path.join(dataDir, "sample_pr_batch.csv"), "utf-8")).map((r) => ({
    prNo: r.pr_no,
    prLine: parseInt(r.pr_line, 10),
    createdAt: r.created_at,
    requester: r.requester,
    department: r.department,
    plant: r.plant,
    itemCode: r.item_code || "",
    description: r.description,
    quantity: parseFloat(r.quantity),
    uom: r.uom,
    estimatedUnitPrice: r.estimated_unit_price ? parseFloat(r.estimated_unit_price) : null,
    needByDate: r.need_by_date,
    urgency: r.urgency || "Normal",
  }));

  return { items, suppliers, poHistory, contracts, contractLines, prLines };
}

describe("Corvo Procurement Decision Engine (Policy v5.0)", () => {
  it("matches fuzzy descriptions and leaves genuine new items unmatched", () => {
    const { items } = loadData();
    expect(matchItem(null, "brg 6308 ZZ for maintenance", items).item?.itemCode).toBe("ITM-1022");
    expect(matchItem(null, "hyd hose 1/2 inch 2 wire", items).item?.itemCode).toBe("ITM-1035");
    expect(matchItem(null, "pneu cylinder 50x100", items).item?.itemCode).toBe("ITM-1036");
    expect(matchItem(null, "v-belt b-54", items).item?.itemCode).toBe("ITM-1024");
    expect(matchItem(null, "eot crane 5 ton", items).item?.itemCode).toBe("ITM-1071");
    expect(matchItem(null, "Drinking water purifier 50 LPH", items).matched).toBe(false);
    expect(matchItem(null, "Ultrasonic thickness gauge", items).matched).toBe(false);
  });

  it("matches Worked Examples preferred supplier rankings as of 2026-11-01", () => {
    const { suppliers, poHistory, contracts, contractLines } = loadData();

    const r1048 = buildPreferredSuppliersForItem("ITM-1048", "2026-11-01", suppliers, poHistory, contracts, contractLines, POLICY_V5_DEFAULT);
    expect(r1048.map((r) => r.supplierId)).toEqual(["S029", "S030"]);

    const r1036 = buildPreferredSuppliersForItem("ITM-1036", "2026-11-01", suppliers, poHistory, contracts, contractLines, POLICY_V5_DEFAULT);
    expect(r1036.map((r) => r.supplierId)).toEqual(["S023", "S022", "S024"]);

    const r1016 = buildPreferredSuppliersForItem("ITM-1016", "2026-11-01", suppliers, poHistory, contracts, contractLines, POLICY_V5_DEFAULT);
    expect(r1016.map((r) => r.supplierId)).toEqual(["S009", "S010"]);
  });

  it("processes sample_pr_batch.csv and matches key Worked Examples & edge cases", () => {
    const data = loadData();
    const res = runDecisionEngine({ ...data, policy: POLICY_V5_DEFAULT });
    const byPr = new Map(res.prDecisionRows.map((r) => [`${r.pr_no}/${r.pr_line}`, r]));

    // Example 1: Contract PO
    expect(byPr.get("PR-26-00019/1")?.route).toBe("CONTRACT_PO");
    expect(byPr.get("PR-26-00019/1")?.supplier_id).toBe("S001");

    // Example 5: Split PRs clubbed into one requirement (SPOT_PO S024)
    const g146 = byPr.get("PR-26-00146/1")?.group_id;
    expect(g146).toBeDefined();
    expect(byPr.get("PR-26-00144/1")?.group_id).toBe(g146);
    expect(byPr.get("PR-26-00145/1")?.group_id).toBe(g146);
    expect(byPr.get("PR-26-00146/1")?.route).toBe("SPOT_PO");
    expect(byPr.get("PR-26-00146/1")?.supplier_id).toBe("S024");

    // Example 6: Different plants not clubbed
    expect(byPr.get("PR-26-00106/1")?.group_id).not.toBe(byPr.get("PR-26-00103/1")?.group_id);

    // Example 7: Free-text matched Spot PO
    expect(byPr.get("PR-26-00088/1")?.resolved_item_code).toBe("ITM-1035");
    expect(byPr.get("PR-26-00088/1")?.route).toBe("SPOT_PO");
    expect(byPr.get("PR-26-00088/1")?.supplier_id).toBe("S023");

    // Example 8: Emergency PO
    expect(byPr.get("PR-26-00059/1")?.route).toBe("EMERGENCY_PO");
    expect(byPr.get("PR-26-00059/1")?.supplier_id).toBe("S014");

    // Example 10: Small but never bought -> RFQ
    expect(byPr.get("PR-26-00050/1")?.route).toBe("RFQ");

    // Example 11: RFP
    expect(byPr.get("PR-26-00100/1")?.route).toBe("RFP");

    // Example 12: Capex
    expect(byPr.get("PR-26-00047/1")?.route).toBe("CAPEX_SOURCING");

    // Example 13: New item
    expect(byPr.get("PR-26-00170/1")?.route).toBe("NEW_ITEM_SOURCING");
    expect(byPr.get("PR-26-00170/1")?.resolved_item_code).toBe("NEW");

    // Edge cases: invalid qty and unknown plant
    expect(byPr.get("PR-26-00172/1")?.route).toBe("NOT_PROCESSED");
    expect(byPr.get("PR-26-00173/1")?.route).toBe("NOT_PROCESSED");
  });

  it("supports policy-as-data amendments without code changes", () => {
    const data = loadData();
    const amended: PolicyConfig = JSON.parse(JSON.stringify(POLICY_V5_DEFAULT));
    amended.version = "5.1";
    // Add a plant-specific rule for CHK1 Office & IT -> SPOT_PO under ₹1,00,000
    amended.rules.splice(1, 0, {
      id: "rule-chk1-it",
      clause: "5.1b",
      name: "CHK1 Office & IT fast-track Spot PO under 1L",
      conditions: { plant: ["CHK1"], category: ["Office & IT"], maxValue: 100000 },
      outcome: "PO",
      route: "SPOT_PO",
      supplierSource: "FIRST_PREFERRED",
    });

    const res = runDecisionEngine({ ...data, policy: amended });
    expect(res.prDecisionRows[0].policy_version).toBe("5.1");
  });
});
