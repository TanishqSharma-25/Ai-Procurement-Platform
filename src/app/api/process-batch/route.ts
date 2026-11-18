import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv, toCsv } from "@/lib/csv";
import { runDecisionEngine } from "@/engine/decisionEngine";
import { PrLineInput } from "@/engine/types";
import { loadActivePolicy, loadMasterData } from "@/lib/engineLoader";

const OUTPUT_HEADERS = [
  "pr_no",
  "pr_line",
  "resolved_item_code",
  "group_id",
  "po_id",
  "decision",
  "route",
  "supplier_id",
  "unit_price",
  "group_value_inr",
  "suggested_supplier_ids",
  "policy_version",
  "reason",
];

function mapCsvRowsToPrLines(rows: Record<string, string>[]): PrLineInput[] {
  return rows.map((r) => ({
    prNo: r.pr_no,
    prLine: parseInt(r.pr_line || "1", 10),
    createdAt: r.created_at,
    requester: r.requester || "Unknown",
    department: r.department || "General",
    plant: r.plant,
    itemCode: r.item_code || "",
    description: r.description || "",
    quantity: parseFloat(r.quantity || "0"),
    uom: r.uom || "NOS",
    estimatedUnitPrice: r.estimated_unit_price ? parseFloat(r.estimated_unit_price) : null,
    needByDate: r.need_by_date,
    urgency: r.urgency || "Normal",
  }));
}

export async function POST(req: NextRequest) {
  try {
    let csvText = "";
    let batchName = `batch-${new Date().toISOString().slice(0, 19)}.csv`;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "Missing CSV file in form field 'file'" }, { status: 400 });
      }
      csvText = await file.text();
      batchName = file.name || batchName;
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      csvText = body.csvText || "";
      batchName = body.batchName || batchName;
    } else {
      csvText = await req.text();
    }

    if (!csvText.trim()) {
      return NextResponse.json({ error: "Empty CSV payload" }, { status: 400 });
    }

    const parsedLines = mapCsvRowsToPrLines(parseCsv(csvText));
    const [policy, master] = await Promise.all([loadActivePolicy(), loadMasterData()]);
    const result = runDecisionEngine({ prLines: parsedLines, ...master, policy });

    const batch = await prisma.prBatch.create({
      data: { name: batchName, policyVersion: policy.version },
    });

    if (parsedLines.length > 0) {
      await prisma.prLine.createMany({
        data: parsedLines.map((l) => ({
          batchId: batch.id,
          ...l,
          itemCode: l.itemCode || null,
        })),
      });
    }

    if (result.requirements.length > 0) {
      await prisma.requirement.createMany({
        data: result.requirements.map((r) => ({
          batchId: batch.id,
          groupId: r.groupId,
          resolvedItemCode: r.resolvedItemCode,
          plant: r.plant,
          requirementDate: r.requirementDate,
          isEmergency: r.isEmergency,
          totalQuantity: r.totalQuantity,
          unitPrice: r.unitPrice,
          groupValueInr: r.groupValueInr,
          decision: r.decision,
          route: r.route,
          supplierId: r.supplierId || null,
          poId: r.poId || null,
          suggestedSupplierIds: r.suggestedSupplierIds.join(";"),
          policyVersion: r.policyVersion,
          reason: r.reason,
          status: "PENDING",
        })),
      });
    }

    const csvOutput = toCsv(OUTPUT_HEADERS, result.prDecisionRows as unknown as Record<string, unknown>[]);

    if (req.nextUrl.searchParams.get("format") === "csv") {
      return new NextResponse(csvOutput, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="decisions_v${policy.version}.csv"`,
        },
      });
    }

    return NextResponse.json({
      batchId: batch.id,
      batchName,
      policyVersion: policy.version,
      totalLines: parsedLines.length,
      totalRequirements: result.requirements.length,
      decisions: result.prDecisionRows,
      csv: csvOutput,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const batchIdParam = req.nextUrl.searchParams.get("batchId");
    const format = req.nextUrl.searchParams.get("format");

    const batches = await prisma.prBatch.findMany({ orderBy: { id: "desc" } });
    if (batches.length === 0) {
      return NextResponse.json({ batches: [], decisions: [] });
    }

    const targetBatchId = batchIdParam ? parseInt(batchIdParam, 10) : batches[0].id;
    const lines = await prisma.prLine.findMany({ where: { batchId: targetBatchId } });

    const [policy, master] = await Promise.all([loadActivePolicy(), loadMasterData()]);
    const result = runDecisionEngine({
      prLines: lines.map((l) => ({
        prNo: l.prNo,
        prLine: l.prLine,
        createdAt: l.createdAt,
        requester: l.requester,
        department: l.department,
        plant: l.plant,
        itemCode: l.itemCode || "",
        description: l.description,
        quantity: l.quantity,
        uom: l.uom,
        estimatedUnitPrice: l.estimatedUnitPrice,
        needByDate: l.needByDate,
        urgency: l.urgency,
      })),
      ...master,
      policy,
    });

    if (format === "csv") {
      const csvOutput = toCsv(OUTPUT_HEADERS, result.prDecisionRows as unknown as Record<string, unknown>[]);
      return new NextResponse(csvOutput, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="decisions_batch_${targetBatchId}_v${policy.version}.csv"`,
        },
      });
    }

    return NextResponse.json({
      batches,
      activeBatchId: targetBatchId,
      policyVersion: policy.version,
      decisions: result.prDecisionRows,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
