import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const batchIdParam = req.nextUrl.searchParams.get("batchId");
    const batches = await prisma.prBatch.findMany({ orderBy: { id: "desc" } });
    if (batches.length === 0) {
      return NextResponse.json({ batches: [], requirements: [], actions: [] });
    }

    const targetBatchId = batchIdParam ? parseInt(batchIdParam, 10) : batches[0].id;
    const reqRows = await prisma.requirement.findMany({
      where: { batchId: targetBatchId },
      orderBy: { id: "asc" },
    });
    const actions = await prisma.buyerAction.findMany({
      orderBy: { id: "desc" },
      take: 100,
    });

    return NextResponse.json({
      batches,
      activeBatchId: targetBatchId,
      requirements: reqRows,
      actions,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { requirementId, action, actor, comment, overrideRoute, overrideSupplierId } = body as {
      requirementId: number;
      action: "APPROVE" | "OVERRIDE";
      actor: string;
      comment?: string;
      overrideRoute?: string;
      overrideSupplierId?: string;
    };

    const existing = await prisma.requirement.findUnique({ where: { id: requirementId } });
    if (!existing) {
      return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
    }

    if (action === "OVERRIDE" && (!comment || !comment.trim())) {
      return NextResponse.json(
        { error: "Override requires a written comment (Policy Section 8.1)" },
        { status: 400 }
      );
    }

    const newStatus = action === "APPROVE" ? "APPROVED" : "OVERRIDDEN";
    const updated = await prisma.requirement.update({
      where: { id: requirementId },
      data: {
        status: newStatus,
        overrideRoute: action === "OVERRIDE" ? overrideRoute || existing.route : null,
        overrideSupplierId: action === "OVERRIDE" ? overrideSupplierId || existing.supplierId : null,
        overrideComment: comment || null,
        actedBy: actor || "Buyer",
        actedAt: new Date(),
      },
    });

    await prisma.buyerAction.create({
      data: {
        requirementId,
        actionType: action === "APPROVE" ? (existing.decision === "PO" ? "PO_CREATED" : "RFQ_CREATED") : "OVERRIDE",
        actor: actor || "Buyer",
        comment: comment || null,
        previousDecision: `${existing.decision}:${existing.route}`,
        newDecision:
          action === "OVERRIDE"
            ? `OVERRIDE:${overrideRoute || existing.route}`
            : `${existing.decision}:${existing.route}`,
      },
    });

    return NextResponse.json({ requirement: updated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
