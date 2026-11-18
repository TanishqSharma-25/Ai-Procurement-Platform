import { ItemMaster } from "./types";

const ABBREVIATION_MAP: Record<string, string> = {
  brg: "bearing",
  hyd: "hydraulic",
  pneu: "pneumatic",
  cyl: "cylinder",
  ms: "ms",
  ss: "ss",
  alum: "aluminium",
  al: "aluminium",
  qty: "quantity",
  elec: "electric",
};

const NOISE_PATTERNS: RegExp[] = [
  /\s*-\s*urgent\b/gi,
  /\burgent\b/gi,
  /\bas per sample\b/gi,
  /\(repeat\)/gi,
  /\bfor maintenance\b/gi,
  /\bfor production\b/gi,
  /\bfor stores\b/gi,
];

export function normalizeText(input: string): string {
  let s = input.toLowerCase().trim();
  for (const pat of NOISE_PATTERNS) {
    s = s.replace(pat, " ");
  }
  s = s.replace(/["'()]/g, " ");
  s = s.replace(/(\d+)\s*[x×]\s*(\d+)/g, "$1x$2");
  s = s.replace(/-/g, " ");

  const tokens = s
    .split(/[^a-z0-9./]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ABBREVIATION_MAP[t] || t);

  return tokens.join(" ");
}

function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(/\s+/)
    .filter(Boolean);
}

export interface ItemMatchResult {
  matched: boolean;
  item: ItemMaster | null;
  confidence: number;
  method: "EXACT_CODE" | "EXACT_DESC" | "FUZZY_DESC" | "UNMATCHED";
}

export function matchItem(
  itemCode: string | null | undefined,
  description: string,
  itemMaster: ItemMaster[]
): ItemMatchResult {
  const code = (itemCode || "").trim().toUpperCase();
  if (code) {
    const found = itemMaster.find((i) => i.itemCode.toUpperCase() === code);
    if (found) {
      return { matched: true, item: found, confidence: 1.0, method: "EXACT_CODE" };
    }
  }

  const normQuery = normalizeText(description);
  if (!normQuery) {
    return { matched: false, item: null, confidence: 0, method: "UNMATCHED" };
  }

  for (const item of itemMaster) {
    if (normalizeText(item.description) === normQuery) {
      return { matched: true, item, confidence: 1.0, method: "EXACT_DESC" };
    }
  }

  const queryTokens = tokenize(description);
  const querySet = new Set(queryTokens);

  let bestItem: ItemMaster | null = null;
  let bestScore = 0;

  for (const item of itemMaster) {
    const itemTokens = tokenize(item.description);
    const itemSet = new Set(itemTokens);

    const qCompact = queryTokens.join("");
    const iCompact = itemTokens.join("");
    if (qCompact === iCompact) {
      return { matched: true, item, confidence: 0.99, method: "FUZZY_DESC" };
    }

    let intersection = 0;
    for (const t of querySet) {
      if (itemSet.has(t)) intersection++;
    }

    const union = new Set([...querySet, ...itemSet]).size;
    const jaccard = union > 0 ? intersection / union : 0;
    const queryCoverage = querySet.size > 0 ? intersection / querySet.size : 0;
    const itemCoverage = itemSet.size > 0 ? intersection / itemSet.size : 0;

    const querySpecs = queryTokens.filter((t) => /\d/.test(t));
    const itemSpecs = itemTokens.filter((t) => /\d/.test(t));
    let specScore = 1;
    if (querySpecs.length > 0 && itemSpecs.length > 0) {
      const matchedSpecs = querySpecs.filter((qs) =>
        itemSpecs.some((is) => is === qs || is.includes(qs) || qs.includes(is))
      ).length;
      specScore = matchedSpecs / Math.max(querySpecs.length, itemSpecs.length);
    }

    const score = 0.45 * jaccard + 0.35 * ((queryCoverage + itemCoverage) / 2) + 0.2 * specScore;
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  if (bestItem && bestScore >= 0.58) {
    return { matched: true, item: bestItem, confidence: Number(bestScore.toFixed(3)), method: "FUZZY_DESC" };
  }

  return { matched: false, item: null, confidence: Number(bestScore.toFixed(3)), method: "UNMATCHED" };
}
