import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parsePolicyAmendment } from "@/lib/policyParser";
import { loadActivePolicy, loadMasterData } from "@/lib/engineLoader";
import { PolicyConfig } from "@/engine/types";
import { runDecisionEngine } from "@/engine/decisionEngine";

export async function GET() {
  try {
    const policies = await prisma.policyVersion.findMany({ orderBy: { id: "desc" } });
    return NextResponse.json({ policies });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const currentPolicy = await loadActivePolicy();
    let amendmentText = "";
    let customRulesJson: PolicyConfig | null = null;
    let effectiveDateOverride = "";

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const textField = formData.get("amendmentText") as string | null;
      effectiveDateOverride = (formData.get("effectiveDate") as string | null) || "";

      if (file) {
        if (file.name.toLowerCase().endsWith(".pdf")) {
          const pdfParse = (await import("pdf-parse")).default;
          const buffer = Buffer.from(await file.arrayBuffer());
          const parsed = await pdfParse(buffer);
          amendmentText = parsed.text;
        } else {
          amendmentText = await file.text();
        }
      } else if (textField) {
        amendmentText = textField;
      }
    } else {
      const body = await req.json();
      amendmentText = body.amendmentText || "";
      customRulesJson = body.customRulesJson || null;
      effectiveDateOverride = body.effectiveDate || "";
    }

    if (!amendmentText.trim() && !customRulesJson) {
      return NextResponse.json({ error: "Provide amendmentText, a file, or customRulesJson" }, { status: 400 });
    }

    let proposedPolicy: PolicyConfig;
    let changes: string[];
    let changeSummary: string;

    if (customRulesJson) {
      proposedPolicy = customRulesJson;
      changes = [`Custom policy v${proposedPolicy.version} submitted`];
      changeSummary = changes[0];
    } else {
      const parsed = parsePolicyAmendment(amendmentText, currentPolicy);
      proposedPolicy = parsed.proposedPolicy;
      changes = parsed.changes;
      changeSummary = parsed.changeSummary;
    }

    if (effectiveDateOverride) {
      proposedPolicy.effectiveDate = effectiveDateOverride;
    }

    const draft = await prisma.policyVersion.create({
      data: {
        version: proposedPolicy.version,
        title: proposedPolicy.title,
        effectiveDate: proposedPolicy.effectiveDate,
        status: "DRAFT",
        rulesJson: proposedPolicy as object,
        changeSummary,
        sourceText: amendmentText || null,
        createdBy: "Procurement User",
      },
    });

    return NextResponse.json({ draft, changes, changeSummary });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, approvedBy, reprocessLatestBatch, updatedRulesJson } = body as {
      id: number;
      approvedBy?: string;
      reprocessLatestBatch?: boolean;
      updatedRulesJson?: PolicyConfig;
    };

    const target = await prisma.policyVersion.findUnique({ where: { id } });
    if (!target) {
      return NextResponse.json({ error: "Policy version not found" }, { status: 404 });
    }

    await prisma.policyVersion.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "SUPERSEDED" },
    });

    const finalRules = (updatedRulesJson || target.rulesJson) as unknown as PolicyConfig;

    const activated = await prisma.policyVersion.update({
      where: { id },
      data: {
        status: "ACTIVE",
        version: finalRules.version,
        effectiveDate: finalRules.effectiveDate,
        rulesJson: finalRules as object,
        approvedBy: approvedBy || "Head of Procurement",
        approvedAt: new Date(),
      },
    });

    let reprocessedBatchId: number | null = null;
    if (reprocessLatestBatch) {
      const latest = await prisma.prBatch.findFirst({ orderBy: { id: "desc" } });
      if (latest) {
        const lines = await prisma.prLine.findMany({ where: { batchId: latest.id } });
        const master = await loadMasterData();
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
          policy: finalRules,
        });

        await prisma.requirement.deleteMany({ where: { batchId: latest.id } });
        await prisma.requirement.createMany({
          data: result.requirements.map((r) => ({
            batchId: latest.id,
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
        await prisma.prBatch.update({
          where: { id: latest.id },
          data: { policyVersion: finalRules.version },
        });
        reprocessedBatchId = latest.id;
      }
    }

    return NextResponse.json({ activated, reprocessedBatchId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
