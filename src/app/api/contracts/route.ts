import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseContractPdfText } from "@/lib/contractPdfParser";

export async function GET() {
  try {
    const [contracts, lines] = await Promise.all([
      prisma.contract.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.contractLine.findMany(),
    ]);
    return NextResponse.json({ contracts, lines });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "Missing PDF file" }, { status: 400 });
      }
      const pdfParse = (await import("pdf-parse")).default;
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await pdfParse(buffer);
      const extracted = parseContractPdfText(parsed.text);

      if (!extracted.contractId || !extracted.supplierId) {
        return NextResponse.json(
          { error: "Could not extract Contract No. or Supplier ID from PDF", extracted },
          { status: 422 }
        );
      }

      const saved = await prisma.contract.upsert({
        where: { contractId: extracted.contractId },
        update: {},
        create: {
          contractId: extracted.contractId,
          supplierId: extracted.supplierId,
          supplierName: extracted.supplierName || extracted.supplierId,
          startDate: extracted.startDate,
          endDate: extracted.endDate,
          valueCap: extracted.valueCap,
          consumedValue: 0,
          sourceType: "PDF_ONLY",
          pdfFilename: file.name,
          lines: {
            create: extracted.lines.map((l) => ({
              itemCode: l.itemCode,
              description: l.description,
              uom: l.uom,
              rate: l.rate,
            })),
          },
        },
      });

      return NextResponse.json({ contract: saved, lines: extracted.lines });
    }

    const body = await req.json();
    const { contractId, supplierId, supplierName, startDate, endDate, valueCap, lines } = body;
    const saved = await prisma.contract.create({
      data: {
        contractId,
        supplierId,
        supplierName,
        startDate,
        endDate,
        valueCap: Number(valueCap),
        consumedValue: 0,
        sourceType: "PDF_ONLY",
        lines: {
          create: Array.isArray(lines)
            ? lines.map((l: { itemCode: string; description: string; uom: string; rate: number }) => ({
                itemCode: l.itemCode,
                description: l.description,
                uom: l.uom,
                rate: Number(l.rate),
              }))
            : [],
        },
      },
    });

    return NextResponse.json({ contract: saved });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
