export interface ItemMaster {
  itemCode: string;
  description: string;
  uom: string;
  category: string;
  itemType: "Material" | "Service" | "Capex" | string;
  standardPrice: number;
}

export interface SupplierMaster {
  supplierId: string;
  name: string;
  city: string;
  categories: string;
  status: "Active" | "Blocked" | "Inactive" | string;
  onTimePct: number;
  qualityRating: number;
}

export interface PoHistoryRecord {
  poNumber: string;
  poDate: string;
  supplierId: string;
  itemCode: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  plant: string;
  deliveredOnTime: boolean;
}

export interface ContractRecord {
  contractId: string;
  supplierId: string;
  supplierName: string;
  startDate: string;
  endDate: string;
  valueCap: number;
  consumedValue: number;
  sourceType?: string;
}

export interface ContractLineRecord {
  contractId: string;
  itemCode: string;
  description: string;
  uom: string;
  rate: number;
}

export interface PrLineInput {
  prNo: string;
  prLine: number;
  createdAt: string;
  requester: string;
  department: string;
  plant: string;
  itemCode: string;
  description: string;
  quantity: number;
  uom: string;
  estimatedUnitPrice: number | null;
  needByDate: string;
  urgency: string;
}

export interface RuleConditions {
  itemType?: string[];
  category?: string[];
  plant?: string[];
  urgency?: "Emergency" | "Normal";
  hasUsableContract?: boolean;
  hasActiveSupplierPoInLookback?: boolean;
  minValue?: number;
  maxValue?: number;
  maxValueInclusive?: boolean;
}

export interface PolicyRule {
  id: string;
  clause: string;
  name: string;
  conditions: RuleConditions;
  outcome: "PO" | "SOURCING_REQUEST";
  route:
    | "CAPEX_SOURCING"
    | "CONTRACT_PO"
    | "EMERGENCY_PO"
    | "SPOT_PO"
    | "RFQ"
    | "RFP";
  supplierSource: "CONTRACT" | "FIRST_PREFERRED" | "SUGGEST_PREFERRED";
  suggestCount?: number;
  note?: string;
}

export interface PolicyConfig {
  version: string;
  title: string;
  effectiveDate: string;
  validPlants: string[];
  clubbing: {
    creationWindowDays: number;
    needByWindowDays: number;
    detectUrgentInDescription: boolean;
  };
  valuation: {
    poHistoryLookbackDays: number;
  };
  preferredSuppliers: {
    lookbackDays: number;
    recencyTier1Days: number;
    recencyTier2Days: number;
    weights: {
      poCount: number;
      recency: number;
      hasContract: number;
      onTimePct: number;
      qualityRating: number;
    };
  };
  consolidation: {
    enabled: boolean;
    windowHours: number;
  };
  rules: PolicyRule[];
}

export interface PreferredSupplierEntry {
  itemCode: string;
  rank: number;
  supplierId: string;
  supplierName: string;
  referencePrice: number;
  score: number;
  poCount: number;
  recencyScore: number;
  hasContract: boolean;
  onTimePct: number;
  qualityRating: number;
  explanation: string;
}

export interface PrDecisionRow {
  pr_no: string;
  pr_line: number;
  resolved_item_code: string;
  group_id: string;
  po_id: string;
  decision: string;
  route: string;
  supplier_id: string;
  unit_price: string;
  group_value_inr: string;
  suggested_supplier_ids: string;
  policy_version: string;
  reason: string;
}

export interface RequirementResult {
  groupId: string;
  resolvedItemCode: string;
  plant: string;
  requirementDate: string;
  firstLineCreatedAt: string;
  isEmergency: boolean;
  totalQuantity: number;
  unitPrice: number | null;
  groupValueInr: number | null;
  decision: string;
  route: string;
  supplierId: string;
  poId: string;
  suggestedSupplierIds: string[];
  policyVersion: string;
  reason: string;
  lines: PrLineInput[];
}
