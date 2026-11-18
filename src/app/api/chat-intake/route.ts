import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DraftPrState, processChatIntake } from "@/lib/chatIntake";
import { loadActivePolicy, loadMasterData } from "@/lib/engineLoader";
import { runDecisionEngine } from "@/engine/decisionEngine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, draft, confirm } = body as {
      message?: string;
      draft?: DraftPrState;
      confirm?: boolean;
    };

    const master = await loadMasterData();

    if (confirm && draft) {
      const policy = await loadActivePolicy();
      let latestBatch = await prisma.prBatch.findFirst({ orderBy: { id: "desc" } });
      if (!latestBatch) {
        latestBatch = await prisma.prBatch.create({
          data: { name: "chat-intake-batch", policyVersion: policy.version },
        });
      }

      const existingCount = await prisma.prLine.count({ where: { batchId: latestBatch.id } });
      const prNo = `PR-CHAT-${String(existingCount + 1).padStart(4, "0")}`;
      const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");

      const newLine = {
        prNo,
        prLine: 1,
        createdAt: nowStr,
        requester: draft.requester || "Shopfloor User",
        department: draft.department || "Operations",
        plant: draft.plant || "CHK1",
        itemCode: draft.itemCode || "",
        description: draft.itemDescription || "Unspecified item",
        quantity: draft.quantity || 1,
        uom: draft.uom || "NOS",
        estimatedUnitPrice: draft.estimatedUnitPrice ?? null,
        needByDate: draft.needByDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        urgency: draft.urgency || "Normal",
      };

      await prisma.prLine.create({
        data: {
          batchId: latestBatch.id,
          ...newLine,
          itemCode: newLine.itemCode || null,
        },
      });

      const engineRes = runDecisionEngine({ prLines: [newLine], ...master, policy });
      const reqResult = engineRes.requirements[0];

      const savedReq = await prisma.requirement.create({
        data: {
          batchId: latestBatch.id,
          groupId: `${prNo}-REQ`,
          resolvedItemCode: reqResult.resolvedItemCode,
          plant: reqResult.plant,
          requirementDate: reqResult.requirementDate,
          isEmergency: reqResult.isEmergency,
          totalQuantity: reqResult.totalQuantity,
          unitPrice: reqResult.unitPrice,
          groupValueInr: reqResult.groupValueInr,
          decision: reqResult.decision,
          route: reqResult.route,
          supplierId: reqResult.supplierId || null,
          poId: reqResult.poId || null,
          suggestedSupplierIds: reqResult.suggestedSupplierIds.join(";"),
          policyVersion: reqResult.policyVersion,
          reason: reqResult.reason,
          status: "PENDING",
        },
      });

      return NextResponse.json({
        created: true,
        prNo,
        requirement: savedReq,
        decision: reqResult,
      });
    }

    const response = processChatIntake(message || "", draft || {}, master.items);
    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
