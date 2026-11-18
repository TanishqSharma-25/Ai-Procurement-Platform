import { matchItem } from "@/engine/itemMatcher";
import { ItemMaster } from "@/engine/types";

export interface DraftPrState {
  itemCode?: string;
  itemDescription?: string;
  isNewItem?: boolean;
  quantity?: number;
  uom?: string;
  plant?: string;
  needByDate?: string;
  urgency?: "Normal" | "Emergency";
  estimatedUnitPrice?: number;
  requester?: string;
  department?: string;
}

export interface ChatIntakeResponse {
  reply: string;
  draft: DraftPrState;
  missingFields: string[];
  readyToConfirm: boolean;
  matchedItem?: ItemMaster | null;
}

function resolveRelativeDate(text: string, referenceDate: Date): string | undefined {
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  const lower = text.toLowerCase();
  if (/\btoday\b/.test(lower)) {
    return referenceDate.toISOString().slice(0, 10);
  }
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  const inDaysMatch = lower.match(/in\s+(\d+)\s+days?/);
  if (inDaysMatch) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + parseInt(inDaysMatch[1], 10));
    return d.toISOString().slice(0, 10);
  }

  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let i = 0; i < weekdays.length; i++) {
    if (lower.includes(weekdays[i])) {
      const d = new Date(referenceDate);
      const diff = (i - d.getDay() + 7) % 7 || 7;
      const isNext = lower.includes("next " + weekdays[i]);
      d.setDate(d.getDate() + diff + (isNext && diff <= 7 ? 7 : 0));
      return d.toISOString().slice(0, 10);
    }
  }
  return undefined;
}

export function processChatIntake(
  message: string,
  prevDraft: DraftPrState,
  items: ItemMaster[],
  referenceDate = new Date()
): ChatIntakeResponse {
  const draft: DraftPrState = { ...prevDraft };
  const lower = message.toLowerCase();

  // Extract plant
  if (/\bchk1\b|\bchakan\b/i.test(lower)) draft.plant = "CHK1";
  else if (/\bpun1\b|\bbhosari\b/i.test(lower)) draft.plant = "PUN1";

  // Extract urgency
  if (/\bemergency\b|\burgent\b|\basap\b/i.test(lower)) {
    draft.urgency = "Emergency";
  } else if (/\bnormal\b|\bstandard\b|\bregular\b/i.test(lower) && !draft.urgency) {
    draft.urgency = "Normal";
  }

  // Extract need-by date
  const parsedDate = resolveRelativeDate(message, referenceDate);
  if (parsedDate) draft.needByDate = parsedDate;

  // Extract estimated unit price if mentioned (e.g. "at ₹500", "est 1200", "price 450")
  const priceMatch = message.match(/(?:₹|rs\.?|inr|price|est(?:imate)?(?:\s+unit\s+price)?)\s*[:=]?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
  if (priceMatch) {
    draft.estimatedUnitPrice = parseFloat(priceMatch[1].replace(/,/g, ""));
  }

  // Extract quantity (avoid matching item spec numbers like 6205 or 50x100 if preceded by "need/want/qty")
  const qtyMatch =
    message.match(/(?:need|want|order|buy|request|qty|quantity)\s+(\d+(?:\.\d+)?)\b/i) ||
    (!draft.quantity ? message.match(/^\s*(\d+(?:\.\d+)?)\s*$/) : null);
  if (qtyMatch) {
    draft.quantity = parseFloat(qtyMatch[1]);
  }

  // Match item if not yet matched
  let matchedItem: ItemMaster | null = draft.itemCode
    ? items.find((i) => i.itemCode === draft.itemCode) || null
    : null;

  if (!matchedItem && !draft.isNewItem) {
    const codeMatch = message.match(/\b(ITM-\d+)\b/i);
    // Strip common conversational filler to isolate item phrase
    const cleaned = message
      .replace(/\b(need|want|order|please|for|chakan|bhosari|chk1|pun1|by|next|this|tomorrow|today|urgent|emergency|normal)\b/gi, " ")
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
      .replace(/\b\d+\s+(?=[a-z])/i, " ")
      .trim();

    const res = matchItem(codeMatch ? codeMatch[1] : null, cleaned || message, items);
    if (res.matched && res.item) {
      matchedItem = res.item;
      draft.itemCode = res.item.itemCode;
      draft.itemDescription = res.item.description;
      draft.uom = res.item.uom;
      draft.isNewItem = false;
    } else if (cleaned.length >= 4 && !/^(yes|confirm|ok|no|normal|emergency|chk1|pun1)$/i.test(cleaned)) {
      draft.itemDescription = cleaned;
      draft.isNewItem = true;
      draft.uom = draft.uom || "NOS";
    }
  }

  const missingFields: string[] = [];
  if (!draft.itemDescription) missingFields.push("item");
  if (!draft.quantity || draft.quantity <= 0) missingFields.push("quantity");
  if (!draft.plant) missingFields.push("plant (PUN1 Bhosari or CHK1 Chakan)");
  if (!draft.needByDate) missingFields.push("need-by date");
  if (!draft.urgency) missingFields.push("urgency (Normal or Emergency)");
  if (draft.isNewItem && (draft.estimatedUnitPrice === undefined || draft.estimatedUnitPrice === null)) {
    missingFields.push("estimated unit price in INR (since this is a new item not in the master)");
  }

  if (missingFields.length === 0) {
    const itemLabel = draft.isNewItem
      ? `**New Item**: "${draft.itemDescription}" (est. ₹${draft.estimatedUnitPrice}/${draft.uom})`
      : `**${draft.itemCode}** — ${draft.itemDescription}`;
    return {
      reply: `Got it! Here's your PR summary:\n• Item: ${itemLabel}\n• Quantity: **${draft.quantity} ${draft.uom || "NOS"}**\n• Plant: **${draft.plant}**\n• Need-by: **${draft.needByDate}**\n• Urgency: **${draft.urgency}**\n\nClick **Confirm & Create PR** below to submit it to the decision engine.`,
      draft,
      missingFields: [],
      readyToConfirm: true,
      matchedItem,
    };
  }

  const parts: string[] = [];
  if (matchedItem) {
    parts.push(`Matched **${matchedItem.itemCode} (${matchedItem.description})**.`);
  } else if (draft.isNewItem && draft.itemDescription) {
    parts.push(`"${draft.itemDescription}" isn't in the item master, so I'll treat it as a **New Item** (routed to sourcing).`);
  }
  parts.push(`Could you please provide: **${missingFields.join(", ")}**?`);

  return {
    reply: parts.join(" "),
    draft,
    missingFields,
    readyToConfirm: false,
    matchedItem,
  };
}
