import { PolicyConfig, PolicyRule } from "@/engine/types";

export interface ParsedPolicyProposal {
  proposedPolicy: PolicyConfig;
  changes: string[];
  changeSummary: string;
}

function parseInrAmount(text: string): number | null {
  const lakhMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|lakhs)/i);
  if (lakhMatch) return Math.round(parseFloat(lakhMatch[1]) * 100000);
  const croreMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:crore|cr)/i);
  if (croreMatch) return Math.round(parseFloat(croreMatch[1]) * 10000000);
  const numMatch =
    text.match(/(?:₹|INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i) || text.match(/\b(\d[\d,]{3,})\b/);
  if (numMatch) return Math.round(parseFloat(numMatch[1].replace(/,/g, "")));
  return null;
}

function bumpVersion(currentVersion: string): string {
  const parts = currentVersion.split(".");
  if (parts.length === 2 && !isNaN(Number(parts[1]))) {
    return `${parts[0]}.${Number(parts[1]) + 1}`;
  }
  return `${currentVersion}.1`;
}

export function parsePolicyAmendment(
  amendmentText: string,
  currentPolicy: PolicyConfig
): ParsedPolicyProposal {
  const next: PolicyConfig = JSON.parse(JSON.stringify(currentPolicy));
  const changes: string[] = [];

  const verMatch = amendmentText.match(/version\s+v?(\d+(?:\.\d+)?)/i);
  next.version = verMatch ? verMatch[1] : bumpVersion(currentPolicy.version);
  if (next.version !== currentPolicy.version) {
    changes.push(`Policy version updated from ${currentPolicy.version} to ${next.version}`);
  }

  const dateMatch = amendmentText.match(/effective\s+(?:from\s+|date[:\s]+)?(\d{4}-\d{2}-\d{2})/i);
  if (dateMatch) {
    next.effectiveDate = dateMatch[1];
    changes.push(`Effective date set to ${next.effectiveDate}`);
  }

  const clauses = amendmentText
    .split(/[\n.;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const CATEGORIES = [
    "Steel & Metals",
    "Fasteners",
    "Welding Consumables",
    "Bearings & Transmission",
    "Electrical Spares",
    "Hydraulics & Pneumatics",
    "Packaging",
    "Safety & PPE",
    "Lubricants",
    "Office & IT",
    "Facility Services",
    "Testing & Calibration",
    "Capital Equipment",
  ];

  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    const mentionsPun1 = /\bpun1\b|\bbhosari\b/i.test(clause);
    const mentionsChk1 = /\bchk1\b|\bchakan\b/i.test(clause);
    const matchedPlants = [
      ...(mentionsPun1 ? ["PUN1"] : []),
      ...(mentionsChk1 ? ["CHK1"] : []),
    ];
    const matchedCat = CATEGORIES.find((c) => lower.includes(c.toLowerCase()));

    if (matchedPlants.length > 0 || matchedCat) {
      const amt = parseInrAmount(clause);
      let targetRoute: PolicyRule["route"] | null = null;
      let outcome: PolicyRule["outcome"] = "SOURCING_REQUEST";
      let supplierSource: PolicyRule["supplierSource"] = "SUGGEST_PREFERRED";
      let suggestCount: number | undefined = 3;

      if (/spot\s*po|direct\s*po/i.test(lower)) {
        targetRoute = "SPOT_PO";
        outcome = "PO";
        supplierSource = "FIRST_PREFERRED";
        suggestCount = undefined;
      } else if (/emergency\s*po/i.test(lower)) {
        targetRoute = "EMERGENCY_PO";
        outcome = "PO";
        supplierSource = "FIRST_PREFERRED";
        suggestCount = undefined;
      } else if (/rfp/i.test(lower)) {
        targetRoute = "RFP";
        outcome = "SOURCING_REQUEST";
        suggestCount = 5;
      } else if (/rfq|quotes|sourcing/i.test(lower)) {
        targetRoute = "RFQ";
        outcome = "SOURCING_REQUEST";
        suggestCount = 3;
      } else if (/capex/i.test(lower)) {
        targetRoute = "CAPEX_SOURCING";
        outcome = "SOURCING_REQUEST";
        suggestCount = 5;
      }

      if (targetRoute) {
        const newRule: PolicyRule = {
          id: `rule-custom-${next.rules.length + 1}`,
          clause: `${next.version}.custom`,
          name: clause.slice(0, 80),
          conditions: {
            ...(matchedPlants.length > 0 ? { plant: matchedPlants } : {}),
            ...(matchedCat ? { category: [matchedCat] } : {}),
            ...(amt !== null
              ? /above|over|more than|>=|at least/i.test(lower)
                ? { minValue: amt }
                : { maxValue: amt, maxValueInclusive: /up to|<=|or less/i.test(lower) }
              : {}),
          },
          outcome,
          route: targetRoute,
          supplierSource,
          ...(suggestCount ? { suggestCount } : {}),
        };
        next.rules.splice(Math.min(1, next.rules.length), 0, newRule);
        changes.push(`Added rule (${newRule.clause}): ${clause} -> ${targetRoute}`);
        continue;
      }
    }

    if (/spot\s*po/i.test(lower)) {
      const amt = parseInrAmount(clause);
      const spotRule = next.rules.find((r) => r.route === "SPOT_PO");
      if (amt !== null && spotRule) {
        const old = spotRule.conditions.maxValue;
        spotRule.conditions.maxValue = amt;
        changes.push(
          `Spot PO limit changed from ₹${old?.toLocaleString("en-IN")} to ₹${amt.toLocaleString("en-IN")}`
        );
      }
    }

    if (/emergency\s*po|emergency\s*limit/i.test(lower)) {
      const amt = parseInrAmount(clause);
      const emgRule = next.rules.find((r) => r.route === "EMERGENCY_PO");
      if (amt !== null && emgRule) {
        const old = emgRule.conditions.maxValue;
        emgRule.conditions.maxValue = amt;
        changes.push(
          `Emergency PO limit changed from ₹${old?.toLocaleString("en-IN")} to ₹${amt.toLocaleString("en-IN")}`
        );
      }
    }

    if (/rfq|rfp/i.test(lower) && !/spot|emergency/i.test(lower)) {
      const amt = parseInrAmount(clause);
      const rfqRule = next.rules.find((r) => r.route === "RFQ");
      const rfpRule = next.rules.find((r) => r.route === "RFP");
      if (amt !== null && rfqRule && rfpRule) {
        const old = rfqRule.conditions.maxValue;
        rfqRule.conditions.maxValue = amt;
        rfpRule.conditions.minValue = amt;
        changes.push(
          `RFQ/RFP threshold changed from ₹${old?.toLocaleString("en-IN")} to ₹${amt.toLocaleString("en-IN")}`
        );
      }
    }

    if (/clubbing|creation\s*window/i.test(lower)) {
      const daysMatch = clause.match(/(\d+)\s*(?:calendar\s*)?days/i);
      if (daysMatch) {
        const d = parseInt(daysMatch[1], 10);
        const old = next.clubbing.creationWindowDays;
        next.clubbing.creationWindowDays = d;
        changes.push(`Clubbing creation window changed from ${old} days to ${d} days`);
      }
    }

    if (/consolidat/i.test(lower)) {
      const hrsMatch = clause.match(/(\d+)\s*hours?/i);
      if (hrsMatch) {
        const h = parseInt(hrsMatch[1], 10);
        const old = next.consolidation.windowHours;
        next.consolidation.windowHours = h;
        changes.push(`PO consolidation window changed from ${old} hours to ${h} hours`);
      }
    }
  }

  if (changes.length === 0) {
    changes.push("No automatic rule match; you can edit the Draft Rules JSON below before activating.");
  }

  return {
    proposedPolicy: next,
    changes,
    changeSummary: changes.join("; "),
  };
}
