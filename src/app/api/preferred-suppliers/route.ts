import { NextRequest, NextResponse } from "next/server";
import { buildPreferredSuppliersForItem } from "@/engine/preferredSuppliers";
import { loadActivePolicy, loadMasterData } from "@/lib/engineLoader";
import { toCsv } from "@/lib/csv";

export async function GET(req: NextRequest) {
  try {
    const asOf = req.nextUrl.searchParams.get("asOf") || new Date().toISOString().slice(0, 10);
    const format = req.nextUrl.searchParams.get("format") || "json";
    const itemCodeFilter = req.nextUrl.searchParams.get("itemCode");

    const [policy, master] = await Promise.all([loadActivePolicy(asOf), loadMasterData()]);
    const targetItems = itemCodeFilter
      ? master.items.filter((i) => i.itemCode === itemCodeFilter)
      : master.items.sort((a, b) => a.itemCode.localeCompare(b.itemCode));

    const allRanked = targetItems.flatMap((item) =>
      buildPreferredSuppliersForItem(
        item.itemCode,
        asOf,
        master.suppliers,
        master.poHistory,
        master.contracts,
        master.contractLines,
        policy
      ).slice(0, 3)
    );

    if (format === "csv") {
      const csvText = toCsv(
        ["item_code", "rank", "supplier_id", "reference_price"],
        allRanked.map((r) => ({
          item_code: r.itemCode,
          rank: r.rank,
          supplier_id: r.supplierId,
          reference_price: r.referencePrice,
        }))
      );
      return new NextResponse(csvText, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="preferred_suppliers_${asOf}.csv"`,
        },
      });
    }

    return NextResponse.json({ asOf, count: allRanked.length, preferredSuppliers: allRanked });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
