import {
  ContractLineRecord,
  ContractRecord,
  ItemMaster,
  PoHistoryRecord,
  PolicyConfig,
  PreferredSupplierEntry,
  SupplierMaster,
} from "./types";

export function daysBetween(dateStrA: string, dateStrB: string): number {
  const a = new Date(dateStrA.slice(0, 10) + "T00:00:00Z").getTime();
  const b = new Date(dateStrB.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

export function buildPreferredSuppliersForItem(
  itemCode: string,
  asOfDate: string,
  suppliers: SupplierMaster[],
  poHistory: PoHistoryRecord[],
  contracts: ContractRecord[],
  contractLines: ContractLineRecord[],
  policy: PolicyConfig
): PreferredSupplierEntry[] {
  const asOfDay = asOfDate.slice(0, 10);
  const { lookbackDays, recencyTier1Days, recencyTier2Days, weights } = policy.preferredSuppliers;

  const activeSuppliers = new Map<string, SupplierMaster>();
  for (const s of suppliers) {
    if (s.status === "Active") {
      activeSuppliers.set(s.supplierId, s);
    }
  }

  const contractIdsForItem = new Set(
    contractLines.filter((cl) => cl.itemCode === itemCode).map((cl) => cl.contractId)
  );

  // Eligible suppliers: Active + (>=1 PO in lookbackDays before asOfDay OR contract covering item with startDate <= asOfDay)
  const eligibleIds = new Set<string>();
  const posBySupplier = new Map<string, PoHistoryRecord[]>();

  for (const po of poHistory) {
    if (po.itemCode !== itemCode) continue;
    if (!activeSuppliers.has(po.supplierId)) continue;
    const ageDays = daysBetween(po.poDate, asOfDay);
    if (ageDays > 0 && ageDays <= lookbackDays) {
      eligibleIds.add(po.supplierId);
      const list = posBySupplier.get(po.supplierId) || [];
      list.push(po);
      posBySupplier.set(po.supplierId, list);
    }
  }

  const contractsBySupplier = new Map<string, { contract: ContractRecord; rate: number }[]>();
  for (const c of contracts) {
    if (!contractIdsForItem.has(c.contractId)) continue;
    if (!activeSuppliers.has(c.supplierId)) continue;
    if (c.startDate <= asOfDay) {
      eligibleIds.add(c.supplierId);
      const cl = contractLines.find((l) => l.contractId === c.contractId && l.itemCode === itemCode);
      if (cl) {
        const list = contractsBySupplier.get(c.supplierId) || [];
        list.push({ contract: c, rate: cl.rate });
        contractsBySupplier.set(c.supplierId, list);
      }
    }
  }

  const entries: Omit<PreferredSupplierEntry, "rank">[] = [];

  for (const supplierId of eligibleIds) {
    const sup = activeSuppliers.get(supplierId)!;
    const pos = (posBySupplier.get(supplierId) || []).sort((a, b) =>
      b.poDate.localeCompare(a.poDate)
    );
    const supContracts = (contractsBySupplier.get(supplierId) || []).sort((a, b) =>
      b.contract.startDate.localeCompare(a.contract.startDate)
    );

    const poCount = pos.length;
    let recencyScore = 0;
    if (poCount > 0) {
      const mostRecentDays = daysBetween(pos[0].poDate, asOfDay);
      if (mostRecentDays <= recencyTier1Days) recencyScore = 1.0;
      else if (mostRecentDays <= recencyTier2Days) recencyScore = 0.5;
      else recencyScore = 0.0;
    }

    const hasContract = supContracts.length > 0;
    const referencePrice =
      poCount > 0 ? pos[0].unitPrice : hasContract ? supContracts[0].rate : 0;

    const score =
      poCount * weights.poCount +
      recencyScore * weights.recency +
      (hasContract ? weights.hasContract : 0) +
      (sup.onTimePct / 100) * weights.onTimePct +
      (sup.qualityRating / 5) * weights.qualityRating;

    const parts: string[] = [
      `${poCount} PO(s) in ${lookbackDays}d`,
      `recency=${recencyScore}`,
      hasContract ? "held contract" : "no contract",
      `on-time=${sup.onTimePct}%`,
      `quality=${sup.qualityRating}/5`,
    ];

    entries.push({
      itemCode,
      supplierId,
      supplierName: sup.name,
      referencePrice: Number(referencePrice.toFixed(2)),
      score: Number(score.toFixed(3)),
      poCount,
      recencyScore,
      hasContract,
      onTimePct: sup.onTimePct,
      qualityRating: sup.qualityRating,
      explanation: parts.join(", "),
    });
  }

  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.onTimePct !== a.onTimePct) return b.onTimePct - a.onTimePct;
    return b.qualityRating - a.qualityRating;
  });

  return entries.map((e, idx) => ({ ...e, rank: idx + 1 }));
}

export function suggestSourcingSuppliers(
  item: ItemMaster,
  asOfDate: string,
  neededCount: number,
  suppliers: SupplierMaster[],
  poHistory: PoHistoryRecord[],
  contracts: ContractRecord[],
  contractLines: ContractLineRecord[],
  policy: PolicyConfig
): string[] {
  const preferred = buildPreferredSuppliersForItem(
    item.itemCode,
    asOfDate,
    suppliers,
    poHistory,
    contracts,
    contractLines,
    policy
  );

  const selected = preferred.slice(0, neededCount).map((p) => p.supplierId);
  const selectedSet = new Set(selected);

  if (selected.length < neededCount) {
    const categoryExtras = suppliers
      .filter((s) => {
        if (s.status !== "Active" || selectedSet.has(s.supplierId)) return false;
        const cats = s.categories.split(";").map((c) => c.trim().toLowerCase());
        return cats.includes(item.category.toLowerCase());
      })
      .sort((a, b) => {
        const scoreA = a.onTimePct / 100 + a.qualityRating / 5;
        const scoreB = b.onTimePct / 100 + b.qualityRating / 5;
        return scoreB - scoreA;
      });

    for (const extra of categoryExtras) {
      if (selected.length >= neededCount) break;
      selected.push(extra.supplierId);
      selectedSet.add(extra.supplierId);
    }
  }

  return selected;
}
