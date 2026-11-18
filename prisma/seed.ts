import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { parseCsv } from "../src/lib/csv";
import { POLICY_V5_DEFAULT } from "../src/engine/defaultPolicy";
import { runDecisionEngine } from "../src/engine/decisionEngine";

const prisma = new PrismaClient();

async function main() {
  const dataDir = path.join(process.cwd(), "data");

  if ((await prisma.item.count()) === 0) {
    console.log("Seeding master data...");
    const plantRows = parseCsv(fs.readFileSync(path.join(dataDir, "plants.csv"), "utf-8"));
    await prisma.plant.createMany({
      data: plantRows.map((r) => ({ plant: r.plant, name: r.name })),
      skipDuplicates: true,
    });

    const itemRows = parseCsv(fs.readFileSync(path.join(dataDir, "item_master.csv"), "utf-8"));
    await prisma.item.createMany({
      data: itemRows.map((r) => ({
        itemCode: r.item_code,
        description: r.description,
        uom: r.uom,
        category: r.category,
        itemType: r.item_type,
        standardPrice: parseFloat(r.standard_price),
      })),
      skipDuplicates: true,
    });

    const supRows = parseCsv(fs.readFileSync(path.join(dataDir, "supplier_master.csv"), "utf-8"));
    await prisma.supplier.createMany({
      data: supRows.map((r) => ({
        supplierId: r.supplier_id,
        name: r.name,
        city: r.city,
        categories: r.categories,
        status: r.status,
        onTimePct: parseFloat(r.on_time_pct),
        qualityRating: parseFloat(r.quality_rating),
      })),
      skipDuplicates: true,
    });

    const poRows = parseCsv(fs.readFileSync(path.join(dataDir, "po_history.csv"), "utf-8"));
    await prisma.poHistory.createMany({
      data: poRows.map((r) => ({
        poNumber: r.po_number,
        poDate: r.po_date,
        supplierId: r.supplier_id,
        itemCode: r.item_code,
        quantity: parseFloat(r.quantity),
        uom: r.uom,
        unitPrice: parseFloat(r.unit_price),
        plant: r.plant,
        deliveredOnTime: r.delivered_on_time.toLowerCase() === "true",
      })),
      skipDuplicates: true,
    });

    const regRows = parseCsv(fs.readFileSync(path.join(dataDir, "contract_register.csv"), "utf-8"));
    await prisma.contract.createMany({
      data: regRows.map((r) => ({
        contractId: r.contract_id,
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        startDate: r.start_date,
        endDate: r.end_date,
        valueCap: parseFloat(r.value_cap),
        consumedValue: parseFloat(r.consumed_value),
        sourceType: "REGISTER",
      })),
      skipDuplicates: true,
    });

    const clRows = parseCsv(fs.readFileSync(path.join(dataDir, "contract_lines.csv"), "utf-8"));
    await prisma.contractLine.createMany({
      data: clRows.map((r) => ({
        contractId: r.contract_id,
        itemCode: r.item_code,
        description: r.description,
        uom: r.uom,
        rate: parseFloat(r.rate),
      })),
    });
  }

  if ((await prisma.policyVersion.count()) === 0) {
    console.log("Seeding Policy v5.0...");
    await prisma.policyVersion.create({
      data: {
        version: POLICY_V5_DEFAULT.version,
        title: POLICY_V5_DEFAULT.title,
        effectiveDate: POLICY_V5_DEFAULT.effectiveDate,
        status: "ACTIVE",
        rulesJson: POLICY_V5_DEFAULT as object,
        changeSummary: "Initial baseline Procurement Policy v5.0 (CORVO-PROC-POL-04)",
        createdBy: "Head of Procurement",
        approvedBy: "Head of Procurement",
        approvedAt: new Date(),
      },
    });
  }

  if ((await prisma.prBatch.count()) === 0) {
    console.log("Seeding sample_pr_batch.csv...");
    const sampleRows = parseCsv(fs.readFileSync(path.join(dataDir, "sample_pr_batch.csv"), "utf-8"));
    const parsedLines = sampleRows.map((r) => ({
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

    const batch = await prisma.prBatch.create({
      data: { name: "sample_pr_batch.csv", policyVersion: POLICY_V5_DEFAULT.version },
    });

    await prisma.prLine.createMany({
      data: parsedLines.map((l) => ({
        batchId: batch.id,
        ...l,
        itemCode: l.itemCode || null,
      })),
    });

    const [items, suppliers, poHistory, contracts, contractLines] = await Promise.all([
      prisma.item.findMany(),
      prisma.supplier.findMany(),
      prisma.poHistory.findMany(),
      prisma.contract.findMany(),
      prisma.contractLine.findMany(),
    ]);

    const result = runDecisionEngine({
      prLines: parsedLines,
      items,
      suppliers,
      poHistory,
      contracts,
      contractLines,
      policy: POLICY_V5_DEFAULT,
    });

    await prisma.requirement.createMany({
      data: result.requirements.map((req) => ({
        batchId: batch.id,
        groupId: req.groupId,
        resolvedItemCode: req.resolvedItemCode,
        plant: req.plant,
        requirementDate: req.requirementDate,
        isEmergency: req.isEmergency,
        totalQuantity: req.totalQuantity,
        unitPrice: req.unitPrice,
        groupValueInr: req.groupValueInr,
        decision: req.decision,
        route: req.route,
        supplierId: req.supplierId || null,
        poId: req.poId || null,
        suggestedSupplierIds: req.suggestedSupplierIds.join(";"),
        policyVersion: req.policyVersion,
        reason: req.reason,
        status: "PENDING",
      })),
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
