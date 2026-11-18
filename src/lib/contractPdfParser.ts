export interface ExtractedContract {
  contractId: string;
  supplierId: string;
  supplierName: string;
  startDate: string;
  endDate: string;
  valueCap: number;
  lines: {
    itemCode: string;
    description: string;
    uom: string;
    rate: number;
  }[];
}

export function parseContractPdfText(text: string): ExtractedContract {
  const contractIdMatch = text.match(/Contract\s+No\.?\s*:?\s*(RC-\d{4}-\d+)/i);
  const supplierIdMatch = text.match(/Supplier\s+ID\s*:?\s*(S\d{3})/i);
  const supplierNameMatch = text.match(/and\s+([^,\n]+),\s*[^(\n]*\(Supplier\s+ID/i);
  const termMatch = text.match(/valid\s+from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i);
  const capMatch = text.match(/shall\s+not\s+exceed\s+INR\s+([\d,]+(?:\.\d+)?)/i);

  const lines: ExtractedContract["lines"] = [];
  const rowRegex = /^\s*\d+\s+(ITM-\d+)\s+(.+?)\s+(NOS|KG|PAIR|LTR|MTR|CYL|BRL|BKT|ROL|SET|REAM|MON|JOB|QTR)\s+([\d,]+(?:\.\d+)?)\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(text)) !== null) {
    lines.push({
      itemCode: match[1].trim(),
      description: match[2].trim(),
      uom: match[3].trim(),
      rate: parseFloat(match[4].replace(/,/g, "")),
    });
  }

  return {
    contractId: contractIdMatch ? contractIdMatch[1].trim() : "",
    supplierId: supplierIdMatch ? supplierIdMatch[1].trim() : "",
    supplierName: supplierNameMatch ? supplierNameMatch[1].trim() : "",
    startDate: termMatch ? termMatch[1] : "",
    endDate: termMatch ? termMatch[2] : "",
    valueCap: capMatch ? parseFloat(capMatch[1].replace(/,/g, "")) : 0,
    lines,
  };
}
