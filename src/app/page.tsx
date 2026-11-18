"use client";

import React, { useEffect, useState } from "react";
import {
  MessageSquare,
  ClipboardCheck,
  ShieldCheck,
  Award,
  FileText,
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

type Tab = "intake" | "workspace" | "policy" | "suppliers" | "contracts";

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
}

const DEFAULT_PROMPTS = [
  "need 200 nitrile gloves for Chakan by next Friday",
  "urgent 50 hyd hose 1/2 inch 2 wire for PUN1 tomorrow",
  "need 1 Drinking water purifier 50 LPH for Chakan by 2026-12-01 price 140000",
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>("workspace");

  // Chat Intake
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      text: 'Hi! Type what you need to buy (or click a quick example below). I will match the item, ask for any missing details (quantity, plant, need-by date, urgency), and route your PR.',
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [readyToConfirm, setReadyToConfirm] = useState(false);
  const [batchUploading, setBatchUploading] = useState(false);

  // Buyer Workspace
  const [requirements, setRequirements] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<any | null>(null);
  const [overrideComment, setOverrideComment] = useState("");
  const [overrideRoute, setOverrideRoute] = useState("RFQ");

  // Policy as Data
  const [policies, setPolicies] = useState<any[]>([]);
  const [amendmentText, setAmendmentText] = useState("");
  const [proposedDraft, setProposedDraft] = useState<any | null>(null);
  const [proposedChanges, setProposedChanges] = useState<string[]>([]);
  const [draftJsonText, setDraftJsonText] = useState("");
  const [showJsonEditor, setShowJsonEditor] = useState(false);

  // Preferred Suppliers
  const [asOfDate, setAsOfDate] = useState("2026-11-01");
  const [prefSuppliers, setPrefSuppliers] = useState<any[]>([]);
  const [itemFilter, setItemFilter] = useState("");

  // Contracts
  const [contracts, setContracts] = useState<any[]>([]);
  const [manualContract, setManualContract] = useState({
    contractId: "",
    supplierId: "",
    supplierName: "",
    startDate: "2026-11-15",
    endDate: "2027-11-14",
    valueCap: "",
    itemCode: "",
    description: "",
    uom: "NOS",
    rate: "",
  });

  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  async function refreshWorkspace(batchId?: number) {
    const url = batchId ? `/api/requirements?batchId=${batchId}` : "/api/requirements";
    const res = await fetch(url);
    const data = await res.json();
    setBatches(data.batches || []);
    setSelectedBatchId(data.activeBatchId || null);
    setRequirements(data.requirements || []);
  }

  async function refreshPolicies() {
    const res = await fetch("/api/policies");
    const data = await res.json();
    setPolicies(data.policies || []);
  }

  async function refreshPreferred(dateStr = asOfDate) {
    const res = await fetch(`/api/preferred-suppliers?asOf=${dateStr}`);
    const data = await res.json();
    setPrefSuppliers(data.preferredSuppliers || []);
  }

  async function refreshContracts() {
    const res = await fetch("/api/contracts");
    const data = await res.json();
    setContracts(data.contracts || []);
  }

  useEffect(() => {
    refreshWorkspace();
    refreshPolicies();
    refreshPreferred("2026-11-01");
    refreshContracts();
  }, []);

  async function sendChatMessage(text: string) {
    if (!text.trim()) return;
    setMessages((prev) => [...prev, { role: "user", text }]);
    const res = await fetch("/api/chat-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, draft }),
    });
    const data = await res.json();
    setDraft(data.draft || {});
    setReadyToConfirm(Boolean(data.readyToConfirm));
    setMessages((prev) => [...prev, { role: "assistant", text: data.reply }]);
  }

  async function handleChatSend(e: React.FormEvent) {
    e.preventDefault();
    const msg = chatInput.trim();
    setChatInput("");
    await sendChatMessage(msg);
  }

  async function handleConfirmPr() {
    const res = await fetch("/api/chat-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft, confirm: true }),
    });
    const data = await res.json();
    if (data.created) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Created **${data.prNo}** -> Routed to **${data.decision.route}** (${data.decision.reason})`,
        },
      ]);
      setDraft({});
      setReadyToConfirm(false);
      showToast(`PR ${data.prNo} created & routed to ${data.decision.route}`);
      refreshWorkspace();
    }
  }

  async function handleBatchUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBatchUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/process-batch", { method: "POST", body: fd });
    const data = await res.json();
    setBatchUploading(false);
    if (data.batchId) {
      showToast(
        `Processed ${data.totalLines} PR lines into ${data.totalRequirements} requirements (Policy v${data.policyVersion})`
      );
      await refreshWorkspace(data.batchId);
      setActiveTab("workspace");
    } else {
      showToast(`Error: ${data.error}`);
    }
  }

  async function handleRequirementAction(reqId: number, action: "APPROVE" | "OVERRIDE") {
    const res = await fetch("/api/requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requirementId: reqId,
        action,
        actor: "Buyer",
        comment: action === "OVERRIDE" ? overrideComment : "Approved per policy",
        overrideRoute: action === "OVERRIDE" ? overrideRoute : undefined,
      }),
    });
    const data = await res.json();
    if (data.error) {
      showToast(data.error);
      return;
    }
    setOverrideTarget(null);
    setOverrideComment("");
    showToast(action === "APPROVE" ? "Approved & PO/RFQ created" : "Decision overridden & logged");
    refreshWorkspace(selectedBatchId || undefined);
  }

  async function handleProposeAmendment(file?: File) {
    let res: Response;
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      res = await fetch("/api/policies", { method: "POST", body: fd });
    } else {
      res = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amendmentText }),
      });
    }
    const data = await res.json();
    if (data.draft) {
      setProposedDraft(data.draft);
      setProposedChanges(data.changes || []);
      setDraftJsonText(JSON.stringify(data.draft.rulesJson, null, 2));
      refreshPolicies();
    } else {
      showToast(data.error || "Failed to parse amendment");
    }
  }

  async function handleActivatePolicy(id: number) {
    let parsedOverride = undefined;
    if (showJsonEditor && draftJsonText.trim()) {
      try {
        parsedOverride = JSON.parse(draftJsonText);
      } catch {
        showToast("Invalid JSON in rules editor");
        return;
      }
    }

    const res = await fetch("/api/policies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        approvedBy: "Head of Procurement",
        reprocessLatestBatch: true,
        updatedRulesJson: parsedOverride,
      }),
    });
    const data = await res.json();
    if (data.activated) {
      setProposedDraft(null);
      setProposedChanges([]);
      setAmendmentText("");
      setShowJsonEditor(false);
      showToast(`Activated Policy v${data.activated.version} and reprocessed active batch`);
      refreshPolicies();
      refreshWorkspace();
    }
  }

  async function handleContractPdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/contracts", { method: "POST", body: fd });
    const data = await res.json();
    if (data.contract) {
      showToast(`Added PDF contract ${data.contract.contractId}`);
      refreshContracts();
    } else {
      showToast(data.error || "Could not parse contract PDF");
    }
  }

  async function handleManualContract(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractId: manualContract.contractId,
        supplierId: manualContract.supplierId,
        supplierName: manualContract.supplierName || manualContract.supplierId,
        startDate: manualContract.startDate,
        endDate: manualContract.endDate,
        valueCap: Number(manualContract.valueCap),
        lines: [
          {
            itemCode: manualContract.itemCode,
            description: manualContract.description,
            uom: manualContract.uom,
            rate: Number(manualContract.rate),
          },
        ],
      }),
    });
    const data = await res.json();
    if (data.contract) {
      showToast(`Added contract ${data.contract.contractId}`);
      refreshContracts();
    }
  }

  const activePolicy = policies.find((p) => p.status === "ACTIVE");

  return (
    <div className="min-h-screen flex flex-col bg-black">
      <header className="bg-[#838CE5] text-black  px-6 py-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Sample Project · PR-to-PO Workbench</h1>
          <p className="text-xs text-white">
            Active Policy:{" "}
            <span className="text-black font-medium">
              v{activePolicy?.version || "5.0"} (Effective {activePolicy?.effectiveDate || "2026-04-01"})
            </span>
          </p>
        </div>
        <nav className="flex flex-wrap gap-2">
          {[
            { id: "intake", label: "Chat Intake", icon: MessageSquare },
            { id: "workspace", label: "Buyer Workspace", icon: ClipboardCheck },
            { id: "policy", label: "Policy as Data", icon: ShieldCheck },
            { id: "suppliers", label: "Preferred Suppliers", icon: Award },
            { id: "contracts", label: "Contracts", icon: FileText },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as Tab)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  active
                    ? "bg-[#D6B9FC] text-black"
                    : "text-white hover:bg-[#D6B9FC] hover:text-black"
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-lg shadow-lg text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          {toast}
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        {activeTab === "intake" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-[#D6B9FC] rounded-xl border border-slate-200 shadow-sm flex flex-col h-[600px]">
              <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                <h2 className="font-semibold text-slate-800">Simple Chat PR Intake</h2>
                <button
                  onClick={() => {
                    setDraft({});
                    setReadyToConfirm(false);
                    setMessages([
                      {
                        role: "assistant",
                        text: "Started a new PR. What item do you need, how many, for which plant, and by when?",
                      },
                    ]);
                  }}
                  className="text-xs text-white hover:underline"
                >
                  Reset Chat
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-line ${
                      m.role === "user"
                        ? "ml-auto bg-[#838CE5] text-white"
                        : "bg-[#838CE5] text-white"
                    }`}
                  >
                    {m.text}
                  </div>
                ))}
              </div>
              <div className="p-4 border-t border-slate-100 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {DEFAULT_PROMPTS.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => sendChatMessage(p)}
                      className="text-xs px-2.5 py-1 rounded-full bg-[#838CE5] hover:bg-slate-200 hover:text-black text-white"
                    >
                      {p}
                    </button>
                  ))}
                </div>
                {readyToConfirm && (
                  <button
                    onClick={handleConfirmPr}
                    className="w-full py-2.5 bg-[#838CE5] hover:bg-white hover:text-black text-white font-medium rounded-lg text-sm transition"
                  >
                    Confirm & Create PR
                  </button>
                )}
                <form onSubmit={handleChatSend} className="flex gap-2">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder='e.g. "need 200 nitrile gloves for Chakan by next Friday"'
                    className="flex-1 border bg-black text-white border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium"
                  >
                    Send
                  </button>
                </form>
              </div>
            </div>

            <div className="bg-[#D6B9FC] rounded-xl border border-slate-200 shadow-sm p-5 space-y-4 h-fit">
              <h3 className="font-semibold text-black">Upload PR Batch CSV</h3>
              <p className="text-xs text-black">
                Upload a CSV in the sample PR batch format to run clubbing, contract checks, and PO consolidation under Policy v{activePolicy?.version || "5.0"}.
              </p>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-black rounded-lg p-6 cursor-pointer hover:border-blue-500 transition">
                <Upload className="w-6 h-6 text-[#838CE5] mb-2" />
                <span className="text-sm font-medium text-slate-700">
                  {batchUploading ? "Processing..." : "Choose PR Batch CSV"}
                </span>
                <input type="file" accept=".csv" className="hidden" onChange={handleBatchUpload} />
              </label>
            </div>
          </div>
        )}

        {activeTab === "workspace" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#D6B9FC] p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-black">Buyer Workspace</h2>
                <select
                  value={selectedBatchId || ""}
                  onChange={(e) => refreshWorkspace(Number(e.target.value))}
                  className="border bg-[#838CE5] text-white border-white rounded-lg px-3 py-1.5 text-sm"
                >
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      Batch #{b.id}: {b.name} (v{b.policyVersion})
                    </option>
                  ))}
                </select>
              </div>
              <a
                href={`/api/process-batch?batchId=${selectedBatchId || ""}&format=csv`}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#838CE5] hover:bg-slate-800 text-white rounded-lg text-sm font-medium"
              >
                <Download className="w-4 h-4" />
                Export Decisions CSV
              </a>
            </div>

            <div className="bg-[#D6B9FC] rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#D6B9FC] border-b border-slate-200 text-white text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3">Req ID</th>
                    <th className="px-4 py-3">Item / Plant</th>
                    <th className="px-4 py-3">Route & PO</th>
                    <th className="px-4 py-3">Value (INR)</th>
                    <th className="px-4 py-3">Supplier / Suggested</th>
                    <th className="px-4 py-3">Policy Reason</th>
                    <th className="px-4 py-3">Next Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-black">
                  {requirements.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs font-medium">{r.groupId}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-black">{r.resolvedItemCode}</div>
                        <div className="text-xs text-slate-500">
                          {r.plant} · Qty {r.totalQuantity} {r.isEmergency ? "· EMERGENCY" : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            r.decision === "PO"
                              ? "bg-emerald-100 text-emerald-800"
                              : r.route === "NOT_PROCESSED"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {r.route}
                        </span>
                        {r.poId && <div className="text-xs font-mono text-slate-600 mt-1">{r.poId}</div>}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {r.groupValueInr !== null ? `₹${Number(r.groupValueInr).toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {r.supplierId ? (
                          <span className="font-semibold text-slate-800">
                            {r.supplierId} @ ₹{r.unitPrice}
                          </span>
                        ) : (
                          <span className="text-slate-600">{r.suggestedSupplierIds || "—"}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-xs">
                        <div>
                          v{r.policyVersion}: {r.reason}
                        </div>
                        {r.status !== "PENDING" && (
                          <div className="mt-1 text-blue-700 font-medium">
                            {r.status} by {r.actedBy}{" "}
                            {r.overrideComment ? `— "${r.overrideComment}"` : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.status === "PENDING" ? (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => handleRequirementAction(r.id, "APPROVE")}
                              className="px-2.5 py-1 bg-[#838CE5] hover:bg-blue-700 text-white rounded text-xs font-medium"
                            >
                              {r.decision === "PO" ? "Create PO" : "Start RFQ"}
                            </button>
                            <button
                              onClick={() => {
                                setOverrideTarget(r);
                                setOverrideRoute(r.route);
                              }}
                              className="px-2.5 py-1 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded text-xs"
                            >
                              Override
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs font-medium text-emerald-700">{r.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {overrideTarget && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                <div className="bg-[#D6B9FC] rounded-xl p-6 max-w-md w-full space-y-4 shadow-xl">
                  <h3 className="font-semibold text-slate-900">Override {overrideTarget.groupId}</h3>
                  <select
                    value={overrideRoute}
                    onChange={(e) => setOverrideRoute(e.target.value)}
                    className="w-full border bg-[#838CE5] text-white rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="CONTRACT_PO">CONTRACT_PO</option>
                    <option value="SPOT_PO">SPOT_PO</option>
                    <option value="EMERGENCY_PO">EMERGENCY_PO</option>
                    <option value="RFQ">RFQ</option>
                    <option value="RFP">RFP</option>
                    <option value="NOT_PROCESSED">NOT_PROCESSED</option>
                  </select>
                  <textarea
                    value={overrideComment}
                    onChange={(e) => setOverrideComment(e.target.value)}
                    placeholder="Written reason required (Policy Section 8.1)..."
                    rows={3}
                    className="w-full border bg-[#4753c1] text-black rounded-lg px-3 py-2 text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setOverrideTarget(null)}
                      className="px-3 py-1.5 text-sm text-black"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleRequirementAction(overrideTarget.id, "OVERRIDE")}
                      className="px-4 py-1.5 bg-black text-white rounded-lg text-sm font-medium"
                    >
                      Save Override
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "policy" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#D6B9FC]  rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
              <h2 className="font-semibold text-black">Propose Policy Amendment</h2>
              <p className="text-xs text-slate-500">
                Describe a policy change in plain text or upload an amendment PDF/TXT. Review the preview, then approve to activate from its effective date.
              </p>
              <textarea
                value={amendmentText}
                onChange={(e) => setAmendmentText(e.target.value)}
                rows={4}
                placeholder='e.g. "Version 5.1 effective 2026-11-19. Raise Spot PO limit to 3 lakh. For plant CHK1, Office & IT items below ₹1,00,000 go to SPOT_PO."'
                className="w-full border bg-[#5f6bd5]  border-slate-300 rounded-lg p-3 text-sm"
              />
              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-1.5 px-3 py-2 border bg-[#838CE5] border-slate-300 text-white rounded-lg text-sm cursor-pointer hover:bg-[#5f6bd5]">
                  <Upload className="w-4 h-4" />
                  Upload Amendment PDF/TXT
                  <input
                    type="file"
                    accept=".pdf,.txt,.md,.json"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleProposeAmendment(e.target.files[0])}
                  />
                </label>
                <button
                  onClick={() => handleProposeAmendment()}
                  className="px-4 py-2 bg-[#838CE5] hover:bg-[#5f6bd5] text-white rounded-lg text-sm font-medium"
                >
                  Preview Changes
                </button>
              </div>

              {proposedDraft && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center  justify-between">
                    <div className="flex items-center gap-2 font-semibold text-amber-900 text-sm">
                      <AlertTriangle className="w-4 h-4" />
                      Draft v{proposedDraft.version} (Effective {proposedDraft.effectiveDate})
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowJsonEditor(!showJsonEditor)}
                      className="text-xs text-amber-800 underline"
                    >
                      {showJsonEditor ? "Hide Rules JSON" : "Edit Rules JSON"}
                    </button>
                  </div>
                  <ul className="list-disc pl-5 text-xs text-amber-900 space-y-1">
                    {proposedChanges.map((c, idx) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                  {showJsonEditor && (
                    <textarea
                      value={draftJsonText}
                      onChange={(e) => setDraftJsonText(e.target.value)}
                      rows={10}
                      className="w-full font-mono text-xs border border-amber-300 rounded p-2 bg-white"
                    />
                  )}
                  <button
                    onClick={() => handleActivatePolicy(proposedDraft.id)}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium"
                  >
                    Approve & Activate v{proposedDraft.version} + Reprocess Batch
                  </button>
                </div>
              )}
            </div>

            <div className="bg-[#D6B9FC] rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
              <h2 className="font-semibold text-black">Policy Versions</h2>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {policies.map((p) => (
                  <div key={p.id} className="border bg-[#5f6bd5] border-slate-200 rounded-lg p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between ">
                      <span className="font-semibold text-white">
                        v{p.version} · Effective {p.effectiveDate}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          p.status === "ACTIVE"
                            ? "bg-emerald-100 text-emerald-800"
                            : p.status === "DRAFT"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {p.status}
                      </span>
                    </div>
                    <div className="text-xs text-white">{p.changeSummary}</div>
                    {p.status === "DRAFT" && (
                      <button
                        onClick={() => handleActivatePolicy(p.id)}
                        className="mt-2 px-3 py-1 bg-emerald-600 text-white rounded text-xs font-medium"
                      >
                        Activate Now
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "suppliers" && (
          <div className="space-y-4">
            <div className="bg-[#D6B9FC] p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-black ">Preferred Suppliers (Top 3 per Item)</h2>
                <input
                  type="date"
                  value={asOfDate}
                  onChange={(e) => {
                    setAsOfDate(e.target.value);
                    refreshPreferred(e.target.value);
                  }}
                  className="border bg-[#838CE5] text-white rounded-lg px-3 py-1.5 text-sm"
                />
                <input
                  value={itemFilter}
                  onChange={(e) => setItemFilter(e.target.value)}
                  placeholder="Filter by item code (e.g. ITM-1048)"
                  className="border bg-[#5f6bd5] text-white border-slate-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
              <a
                href={`/api/preferred-suppliers?asOf=${asOfDate}&format=csv`}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#838CE5] hover:bg-[#5f6bd5] text-white rounded-lg text-sm font-medium"
              >
                <Download className="w-4 h-4" />
                Export Top-3 CSV
              </a>
            </div>

            <div className="bg-[#D6B9FC] rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#D6B9FC] border-b border-slate-200 text-white text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3">Item Code</th>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">Supplier</th>
                    <th className="px-4 py-3">Ref Price (INR)</th>
                    <th className="px-4 py-3">Score</th>
                    <th className="px-4 py-3">Why Ranked Here</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {prefSuppliers
                    .filter((p) => !itemFilter || p.itemCode.toLowerCase().includes(itemFilter.toLowerCase()))
                    .slice(0, 120)
                    .map((p, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-mono text-xs">{p.itemCode}</td>
                        <td className="px-4 py-2.5 font-semibold">#{p.rank}</td>
                        <td className="px-4 py-2.5">
                          {p.supplierId} · {p.supplierName}
                        </td>
                        <td className="px-4 py-2.5">₹{p.referencePrice}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{p.score}</td>
                        <td className="px-4 py-2.5 text-xs text-black">{p.explanation}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "contracts" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-[#D6B9FC] rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
              <div className="p-4 border-b border-slate-100 font-semibold text-black">
                Rate Contracts Register & PDF-Only Contracts
              </div>
              <table className="w-full text-left text-sm">
                <thead className="bg-[#D6B9FC] border-b border-slate-200 text-white text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3">Contract ID</th>
                    <th className="px-4 py-3">Supplier</th>
                    <th className="px-4 py-3">Term</th>
                    <th className="px-4 py-3">Consumed / Cap</th>
                    <th className="px-4 py-3">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {contracts.map((c) => (
                    <tr key={c.contractId}>
                      <td className="px-4 py-3 font-mono text-xs font-medium">{c.contractId}</td>
                      <td className="px-4 py-3 text-xs">
                        {c.supplierId} · {c.supplierName}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {c.startDate} to {c.endDate}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        ₹{Number(c.consumedValue).toLocaleString("en-IN")} / ₹
                        {Number(c.valueCap).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="px-2 py-0.5 rounded bg-[#838CE5] ">{c.sourceType}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-[#D6B9FC] rounded-xl border border-slate-200 shadow-sm p-5 space-y-5 h-fit">
              <div>
                <h3 className="font-semibold text-black mb-2">Upload Signed Contract PDF</h3>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-black rounded-lg p-5 cursor-pointer hover:border-blue-500">
                  <Upload className="w-5 h-5 text-white mb-1" />
                  <span className="text-xs font-medium text-black">Extract & Add PDF Contract</span>
                  <input type="file" accept=".pdf" className="hidden" onChange={handleContractPdfUpload} />
                </label>
              </div>

              <form onSubmit={handleManualContract} className="space-y-2.5 border-t border-slate-100 pt-4">
                <h3 className="font-semibold text-black text-sm">Or Add Manually</h3>
                <input
                  required
                  placeholder="Contract ID (e.g. RC-2026-031)"
                  value={manualContract.contractId}
                  onChange={(e) => setManualContract({ ...manualContract, contractId: e.target.value })}
                  className="w-full border bg-[#5f6bd5] text-white border-slate-300 rounded px-3 py-1.5 text-xs"
                />
                <input
                  required
                  placeholder="Supplier ID (e.g. S021)"
                  value={manualContract.supplierId}
                  onChange={(e) => setManualContract({ ...manualContract, supplierId: e.target.value })}
                  className="w-full border bg-[#5f6bd5] text-white border-slate-300 rounded px-3 py-1.5 text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={manualContract.startDate}
                    onChange={(e) => setManualContract({ ...manualContract, startDate: e.target.value })}
                    className="border bg-[#5f6bd5] text-white border-slate-300 rounded px-2 py-1.5 text-xs"
                  />
                  <input
                    type="date"
                    value={manualContract.endDate}
                    onChange={(e) => setManualContract({ ...manualContract, endDate: e.target.value })}
                    className="border bg-[#5f6bd5] text-white border-slate-300 rounded px-2 py-1.5 text-xs"
                  />
                </div>
                <input
                  required
                  type="number"
                  placeholder="Value Cap INR"
                  value={manualContract.valueCap}
                  onChange={(e) => setManualContract({ ...manualContract, valueCap: e.target.value })}
                  className="w-full border bg-[#5f6bd5] text-white border-slate-300 rounded px-3 py-1.5 text-xs"
                />
                <div className="grid grid-cols-3 gap-2">
                  <input
                    required
                    placeholder="Item (ITM-1037)"
                    value={manualContract.itemCode}
                    onChange={(e) => setManualContract({ ...manualContract, itemCode: e.target.value })}
                    className="border bg-[#5f6bd5] text-white border-slate-300 rounded px-2 py-1.5 text-xs"
                  />
                  <input
                    required
                    placeholder="UoM"
                    value={manualContract.uom}
                    onChange={(e) => setManualContract({ ...manualContract, uom: e.target.value })}
                    className="border bg-[#5f6bd5] text-white border-slate-300 rounded px-2 py-1.5 text-xs"
                  />
                  <input
                    required
                    type="number"
                    step="0.01"
                    placeholder="Rate INR"
                    value={manualContract.rate}
                    onChange={(e) => setManualContract({ ...manualContract, rate: e.target.value })}
                    className="border bg-[#5f6bd5] text-white border-slate-300 rounded px-2 py-1.5 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2 bg-[#3947c9] hover:bg-[#5f6bd5] text-white rounded text-xs font-medium"
                >
                  Save Contract
                </button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
