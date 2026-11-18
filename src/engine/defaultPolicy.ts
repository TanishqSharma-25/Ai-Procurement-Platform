import { PolicyConfig } from "./types";

export const POLICY_V5_DEFAULT: PolicyConfig = {
  version: "5.0",
  title: "Corvo Engineering Pvt Ltd: Procurement Policy (PR to PO) — CORVO-PROC-POL-04",
  effectiveDate: "2026-04-01",
  validPlants: ["PUN1", "CHK1"],
  clubbing: {
    creationWindowDays: 14,
    needByWindowDays: 7,
    detectUrgentInDescription: true,
  },
  valuation: {
    poHistoryLookbackDays: 365,
  },
  preferredSuppliers: {
    lookbackDays: 548,
    recencyTier1Days: 90,
    recencyTier2Days: 365,
    weights: {
      poCount: 10,
      recency: 20,
      hasContract: 12,
      onTimePct: 8,
      qualityRating: 6,
    },
  },
  consolidation: {
    enabled: true,
    windowHours: 24,
  },
  rules: [
    {
      id: "rule-5.1",
      clause: "5.1",
      name: "Capex items always require sourcing",
      conditions: {
        itemType: ["Capex"],
      },
      outcome: "SOURCING_REQUEST",
      route: "CAPEX_SOURCING",
      supplierSource: "SUGGEST_PREFERRED",
      suggestCount: 5,
      note: "Needs capex approval.",
    },
    {
      id: "rule-5.2",
      clause: "5.2",
      name: "Active rate contract with available ceiling",
      conditions: {
        hasUsableContract: true,
      },
      outcome: "PO",
      route: "CONTRACT_PO",
      supplierSource: "CONTRACT",
    },
    {
      id: "rule-5.3",
      clause: "5.3",
      name: "Emergency PO up to ₹5,00,000 with 365-day Active supplier history",
      conditions: {
        urgency: "Emergency",
        maxValue: 500000,
        maxValueInclusive: true,
        hasActiveSupplierPoInLookback: true,
      },
      outcome: "PO",
      route: "EMERGENCY_PO",
      supplierSource: "FIRST_PREFERRED",
    },
    {
      id: "rule-5.4",
      clause: "5.4",
      name: "Spot PO below ₹2,00,000 with 365-day Active supplier history",
      conditions: {
        maxValue: 200000,
        maxValueInclusive: false,
        hasActiveSupplierPoInLookback: true,
      },
      outcome: "PO",
      route: "SPOT_PO",
      supplierSource: "FIRST_PREFERRED",
    },
    {
      id: "rule-5.5",
      clause: "5.5",
      name: "RFQ for requirements below ₹10,00,000",
      conditions: {
        maxValue: 1000000,
        maxValueInclusive: false,
      },
      outcome: "SOURCING_REQUEST",
      route: "RFQ",
      supplierSource: "SUGGEST_PREFERRED",
      suggestCount: 3,
    },
    {
      id: "rule-5.6",
      clause: "5.6",
      name: "RFP for requirements ₹10,00,000 or more",
      conditions: {
        minValue: 1000000,
      },
      outcome: "SOURCING_REQUEST",
      route: "RFP",
      supplierSource: "SUGGEST_PREFERRED",
      suggestCount: 5,
    },
  ],
};
