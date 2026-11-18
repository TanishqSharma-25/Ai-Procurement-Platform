import { matchItem } from "./itemMatcher";
import { buildPreferredSuppliersForItem, daysBetween, suggestSourcingSuppliers } from "./preferredSuppliers";
import {
  ContractLineRecord,
  ContractRecord,
  ItemMaster,
  PoHistoryRecord,
  PolicyConfig,
  PolicyRule,
  PrDecisionRow,
  PrLineInput,
  RequirementResult,
  SupplierMaster,
} from "./types";

export interface EngineInput {
  prLines: PrLineInput[];
  items: ItemMaster[];
  suppliers: SupplierMaster[];
  poHistory: PoHistoryRecord[];
  contracts: ContractRecord[];
  contractLines: ContractLineRecord[];
  policy: PolicyConfig;
}

export interface EngineOutput {
  requirements: RequirementResult[];
  prDecisionRows: PrDecisionRow[];
  contractConsumedAfter: Record<string, number>;
}

interface InternalGroup {
  groupId: string;
  item: ItemMaster;
  plant: string;
  firstCreatedAt: string;
  firstNeedByDate: string;
  requirementDate: string;
  isEmergency: boolean;
  lines: PrLineInput[];
}

function hoursBetween(tsA: string, tsB: string): number {
  const a = new Date(tsA.replace(" ", "T") + (tsA.length <= 16 ? ":00Z" : "Z")).getTime();
  const b = new Date(tsB.replace(" ", "T") + (tsB.length <= 16 ? ":00Z" : "Z")).getTime();
  return (b - a) / (1000 * 60 * 60);
}

function ruleMatches(
  rule: PolicyRule,
  ctx: {
    itemType: string;
    category: string;
    plant: string;
    isEmergency: boolean;
    hasUsableContract: boolean;
    hasActiveSupplierPoInLookback: boolean;
    value: number;
  }
): boolean {
  const c = rule.conditions;
  if (c.itemType && c.itemType.length > 0 && !c.itemType.includes(ctx.itemType)) return false;
  if (c.category && c.category.length > 0 && !c.category.includes(ctx.category)) return false;
  if (c.plant && c.plant.length > 0 && !c.plant.includes(ctx.plant)) return false;
  if (c.urgency === "Emergency" && !ctx.isEmergency) return false;
  if (c.urgency === "Normal" && ctx.isEmergency) return false;
  if (c.hasUsableContract !== undefined && c.hasUsableContract !== ctx.hasUsableContract) return false;
  if (
    c.hasActiveSupplierPoInLookback !== undefined &&
    c.hasActiveSupplierPoInLookback !== ctx.hasActiveSupplierPoInLookback
  ) {
    return false;
  }
  if (c.minValue !== undefined && ctx.value < c.minValue) return false;
  if (c.maxValue !== undefined) {
    if (c.maxValueInclusive) {
      if (ctx.value > c.maxValue) return false;
    } else {
      if (ctx.value >= c.maxValue) return false;
    }
  }
  return true;
}

export function runDecisionEngine(input: EngineInput): EngineOutput {
  const { prLines, items, suppliers, poHistory, contracts, contractLines, policy } = input;

  const supplierMap = new Map(suppliers.map((s) => [s.supplierId, s]));
  const activeSupplierIds = new Set(
    suppliers.filter((s) => s.status === "Active").map((s) => s.supplierId)
  );
  const consumedMap: Record<string, number> = {};
  for (const c of contracts) {
    consumedMap[c.contractId] = c.consumedValue || 0;
  }

  const validPlants = new Set(policy.validPlants);
  const requirements: RequirementResult[] = [];
  const validMatchedLines: { line: PrLineInput; item: ItemMaster; isEmergency: boolean }[] = [];

  let reqSeq = 1;
  const nextGroupId = () => `REQ-${String(reqSeq++).padStart(4, "0")}`;

  // Step 0 & 1: Validate & Match Items
  for (const line of prLines) {
    if (line.quantity <= 0) {
      requirements.push({
        groupId: nextGroupId(),
        resolvedItemCode: line.itemCode || "INVALID",
        plant: line.plant,
        requirementDate: line.createdAt.slice(0, 10),
        firstLineCreatedAt: line.createdAt,
        isEmergency: line.urgency === "Emergency",
        totalQuantity: line.quantity,
        unitPrice: line.estimatedUnitPrice,
        groupValueInr: 0,
        decision: "NOT_PROCESSED",
        route: "NOT_PROCESSED",
        supplierId: "",
        poId: "",
        suggestedSupplierIds: [],
        policyVersion: policy.version,
        reason: `Invalid quantity (${line.quantity}). Quantity must be greater than zero.`,
        lines: [line],
      });
      continue;
    }

    if (!validPlants.has(line.plant)) {
      requirements.push({
        groupId: nextGroupId(),
        resolvedItemCode: line.itemCode || "UNKNOWN",
        plant: line.plant,
        requirementDate: line.createdAt.slice(0, 10),
        firstLineCreatedAt: line.createdAt,
        isEmergency: line.urgency === "Emergency",
        totalQuantity: line.quantity,
        unitPrice: line.estimatedUnitPrice,
        groupValueInr: null,
        decision: "NOT_PROCESSED",
        route: "NOT_PROCESSED",
        supplierId: "",
        poId: "",
        suggestedSupplierIds: [],
        policyVersion: policy.version,
        reason: `Plant '${line.plant}' is not covered by policy (valid plants: ${policy.validPlants.join(", ")}).`,
        lines: [line],
      });
      continue;
    }

    const match = matchItem(line.itemCode, line.description, items);
    const isEmergency =
      line.urgency === "Emergency" ||
      (policy.clubbing.detectUrgentInDescription && /\burgent\b/i.test(line.description));

    if (!match.matched || !match.item) {
      const estPrice = line.estimatedUnitPrice ?? 0;
      const val = Number((line.quantity * estPrice).toFixed(2));
      requirements.push({
        groupId: nextGroupId(),
        resolvedItemCode: "NEW",
        plant: line.plant,
        requirementDate: line.createdAt.slice(0, 10),
        firstLineCreatedAt: line.createdAt,
        isEmergency,
        totalQuantity: line.quantity,
        unitPrice: line.estimatedUnitPrice,
        groupValueInr: line.estimatedUnitPrice !== null ? val : null,
        decision: "SOURCING_REQUEST",
        route: "NEW_ITEM_SOURCING",
        supplierId: "",
        poId: "",
        suggestedSupplierIds: [],
        policyVersion: policy.version,
        reason: `Clause 1.2: Item not found in item master; routed to NEW_ITEM_SOURCING (never clubbed, no supplier suggestions).`,
        lines: [line],
      });
      continue;
    }

    validMatchedLines.push({ line, item: match.item, isEmergency });
  }

  // Step 2: Sort by creation time, then PR number, then line number, and club (Section 2.2)
  validMatchedLines.sort((a, b) => {
    const tCmp = a.line.createdAt.localeCompare(b.line.createdAt);
    if (tCmp !== 0) return tCmp;
    const pCmp = a.line.prNo.localeCompare(b.line.prNo);
    if (pCmp !== 0) return pCmp;
    return a.line.prLine - b.line.prLine;
  });

  const groups: InternalGroup[] = [];
  for (const entry of validMatchedLines) {
    const { line, item, isEmergency } = entry;
    const lineDate = line.createdAt.slice(0, 10);

    let joined: InternalGroup | null = null;
    for (const g of groups) {
      if (g.item.itemCode !== item.itemCode || g.plant !== line.plant) continue;
      const creationDiff = daysBetween(g.requirementDate, lineDate);
      const needByDiff = Math.abs(daysBetween(g.firstNeedByDate, line.needByDate));
      if (
        creationDiff >= 0 &&
        creationDiff <= policy.clubbing.creationWindowDays &&
        needByDiff <= policy.clubbing.needByWindowDays
      ) {
        joined = g;
        break; // earliest eligible group
      }
    }

    if (joined) {
      joined.lines.push(line);
      if (isEmergency) joined.isEmergency = true;
    } else {
      groups.push({
        groupId: nextGroupId(),
        item,
        plant: line.plant,
        firstCreatedAt: line.createdAt,
        firstNeedByDate: line.needByDate,
        requirementDate: lineDate,
        isEmergency,
        lines: [line],
      });
    }
  }

  // Step 3: Evaluate each requirement in order of creation time
  const evaluatedReqs: RequirementResult[] = [];

  for (const g of groups) {
    const totalQty = g.lines.reduce((sum, l) => sum + l.quantity, 0);
    const reqDate = g.requirementDate;

    // 4.1 Applicable contracts
    const applicableContracts: { contract: ContractRecord; rate: number }[] = [];
    for (const c of contracts) {
      if (!activeSupplierIds.has(c.supplierId)) continue;
      if (reqDate < c.startDate || reqDate > c.endDate) continue;
      const cl = contractLines.find(
        (l) => l.contractId === c.contractId && l.itemCode === g.item.itemCode
      );
      if (cl) {
        applicableContracts.push({ contract: c, rate: cl.rate });
      }
    }
    applicableContracts.sort((a, b) => a.rate - b.rate);

    // 4.2 & 4.3 Usable contract (lowest rate with enough ceiling)
    let usableContract: { contract: ContractRecord; rate: number } | null = null;
    for (const ac of applicableContracts) {
      const consumed = consumedMap[ac.contract.contractId] ?? 0;
      const reqCostAtContract = totalQty * ac.rate;
      if (consumed + reqCostAtContract <= ac.contract.valueCap) {
        usableContract = ac;
        break;
      }
    }

    // 3.1 Valuation
    let unitPrice: number;
    let priceBasis: string;
    if (usableContract) {
      unitPrice = usableContract.rate;
      priceBasis = `contract ${usableContract.contract.contractId} rate ₹${unitPrice}`;
    } else if (applicableContracts.length > 0) {
      unitPrice = applicableContracts[0].rate;
      priceBasis = `lowest applicable contract ${applicableContracts[0].contract.contractId} rate ₹${unitPrice} (ceiling exceeded)`;
    } else {
      const recentActivePos = poHistory
        .filter((po) => {
          if (po.itemCode !== g.item.itemCode) return false;
          const age = daysBetween(po.poDate, reqDate);
          return age > 0 && age <= policy.valuation.poHistoryLookbackDays;
        })
        .sort((a, b) => b.poDate.localeCompare(a.poDate));

      if (recentActivePos.length > 0) {
        unitPrice = recentActivePos[0].unitPrice;
        priceBasis = `most recent PO ${recentActivePos[0].poNumber} (${recentActivePos[0].poDate}) at ₹${unitPrice}`;
      } else {
        unitPrice = g.item.standardPrice;
        priceBasis = `item master standard price ₹${unitPrice}`;
      }
    }

    const groupValueInr = Number((totalQty * unitPrice).toFixed(2));

    // Check 365-day Active supplier PO history
    const activePoInLookback = poHistory.some((po) => {
      if (po.itemCode !== g.item.itemCode) return false;
      if (!activeSupplierIds.has(po.supplierId)) return false;
      const age = daysBetween(po.poDate, reqDate);
      return age > 0 && age <= policy.valuation.poHistoryLookbackDays;
    });

    // Evaluate ordered Policy Rules (Section 5)
    let matchedRule: PolicyRule | null = null;
    for (const rule of policy.rules) {
      if (
        ruleMatches(rule, {
          itemType: g.item.itemType,
          category: g.item.category,
          plant: g.plant,
          isEmergency: g.isEmergency,
          hasUsableContract: usableContract !== null,
          hasActiveSupplierPoInLookback: activePoInLookback,
          value: groupValueInr,
        })
      ) {
        matchedRule = rule;
        break;
      }
    }

    // Fallback to RFQ if no rule matched
    const decision = matchedRule ? matchedRule.outcome : "SOURCING_REQUEST";
    const route = matchedRule ? matchedRule.route : "RFQ";
    const clause = matchedRule ? matchedRule.clause : "fallback";

    let supplierId = "";
    let finalUnitPrice = unitPrice;
    let finalValue = groupValueInr;
    let suggestedSupplierIds: string[] = [];
    let reason = `Clause ${clause} (${policy.version}): Valued at ${priceBasis}`;

    if (matchedRule?.supplierSource === "CONTRACT" && usableContract) {
      supplierId = usableContract.contract.supplierId;
      finalUnitPrice = usableContract.rate;
      finalValue = Number((totalQty * finalUnitPrice).toFixed(2));
      consumedMap[usableContract.contract.contractId] += finalValue;
      const supName = supplierMap.get(supplierId)?.name || supplierId;
      reason = `Clause ${clause}: Active contract ${usableContract.contract.contractId} with ${supplierId} (${supName}) at ₹${finalUnitPrice}.`;
    } else if (matchedRule?.supplierSource === "FIRST_PREFERRED") {
      const pref = buildPreferredSuppliersForItem(
        g.item.itemCode,
        reqDate,
        suppliers,
        poHistory,
        contracts,
        contractLines,
        policy
      );
      if (pref.length > 0) {
        supplierId = pref[0].supplierId;
        finalUnitPrice = pref[0].referencePrice;
        finalValue = Number((totalQty * finalUnitPrice).toFixed(2));
        reason = `Clause ${clause}: ${route} to 1st preferred supplier ${supplierId} (${pref[0].supplierName}) at ref price ₹${finalUnitPrice} (valued via ${priceBasis}).`;
      }
    } else {
      const count = matchedRule?.suggestCount ?? 3;
      suggestedSupplierIds = suggestSourcingSuppliers(
        g.item,
        reqDate,
        count,
        suppliers,
        poHistory,
        contracts,
        contractLines,
        policy
      );
      reason = `Clause ${clause}: ${route} (value ₹${finalValue.toLocaleString("en-IN")}, ${priceBasis}). Suggested ${suggestedSupplierIds.length} Active suppliers.${matchedRule?.note ? " " + matchedRule.note : ""}`;
    }

    evaluatedReqs.push({
      groupId: g.groupId,
      resolvedItemCode: g.item.itemCode,
      plant: g.plant,
      requirementDate: reqDate,
      firstLineCreatedAt: g.firstCreatedAt,
      isEmergency: g.isEmergency,
      totalQuantity: totalQty,
      unitPrice: Number(finalUnitPrice.toFixed(2)),
      groupValueInr: Number(finalValue.toFixed(2)),
      decision,
      route,
      supplierId,
      poId: "",
      suggestedSupplierIds,
      policyVersion: policy.version,
      reason,
      lines: g.lines,
    });
  }

  // Step 4: PO Consolidation (Section 7)
  const openPos: {
    poId: string;
    supplierId: string;
    plant: string;
    route: string;
    firstCreatedAt: string;
  }[] = [];
  let poSeq = 1;

  for (const req of evaluatedReqs) {
    if (req.decision !== "PO") continue;
    let assignedPoId = "";

    if (policy.consolidation.enabled) {
      for (const po of openPos) {
        if (
          po.supplierId === req.supplierId &&
          po.plant === req.plant &&
          po.route === req.route
        ) {
          const hrs = hoursBetween(po.firstCreatedAt, req.firstLineCreatedAt);
          if (hrs >= 0 && hrs <= policy.consolidation.windowHours) {
            assignedPoId = po.poId;
            break;
          }
        }
      }
    }

    if (!assignedPoId) {
      assignedPoId = `PO-${String(poSeq++).padStart(4, "0")}`;
      openPos.push({
        poId: assignedPoId,
        supplierId: req.supplierId,
        plant: req.plant,
        route: req.route,
        firstCreatedAt: req.firstLineCreatedAt,
      });
    }

    req.poId = assignedPoId;
  }

  const allReqs = [...requirements, ...evaluatedReqs];

  // Build 1 row per PR line in original input order
  const lineToReq = new Map<string, RequirementResult>();
  for (const r of allReqs) {
    for (const l of r.lines) {
      lineToReq.set(`${l.prNo}::${l.prLine}`, r);
    }
  }

  const prDecisionRows: PrDecisionRow[] = prLines.map((l) => {
    const r = lineToReq.get(`${l.prNo}::${l.prLine}`)!;
    const isPo = r.decision === "PO";
    return {
      pr_no: l.prNo,
      pr_line: l.prLine,
      resolved_item_code: r.resolvedItemCode,
      group_id: r.groupId,
      po_id: r.poId,
      decision: r.decision,
      route: r.route,
      supplier_id: isPo ? r.supplierId : "",
      unit_price: isPo && r.unitPrice !== null ? String(r.unitPrice) : "",
      group_value_inr: r.groupValueInr !== null ? String(r.groupValueInr) : "",
      suggested_supplier_ids: r.suggestedSupplierIds.join(";"),
      policy_version: r.policyVersion,
      reason: r.reason,
    };
  });

  return {
    requirements: allReqs,
    prDecisionRows,
    contractConsumedAfter: consumedMap,
  };
}
