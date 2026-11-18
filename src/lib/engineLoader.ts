import { prisma } from "./prisma";
import { POLICY_V5_DEFAULT } from "@/engine/defaultPolicy";
import { PolicyConfig } from "@/engine/types";

export async function loadActivePolicy(asOfDate?: string): Promise<PolicyConfig> {
  const activeRows = await prisma.policyVersion.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ effectiveDate: "desc" }, { id: "desc" }],
  });

  if (activeRows.length === 0) return POLICY_V5_DEFAULT;

  if (asOfDate) {
    const eligible = activeRows.find((r) => r.effectiveDate <= asOfDate.slice(0, 10));
    if (eligible) return eligible.rulesJson as unknown as PolicyConfig;
  }

  return activeRows[0].rulesJson as unknown as PolicyConfig;
}

export async function loadMasterData() {
  const [items, suppliers, poHistory, contracts, contractLines] = await Promise.all([
    prisma.item.findMany(),
    prisma.supplier.findMany(),
    prisma.poHistory.findMany(),
    prisma.contract.findMany(),
    prisma.contractLine.findMany(),
  ]);

  return { items, suppliers, poHistory, contracts, contractLines };
}
