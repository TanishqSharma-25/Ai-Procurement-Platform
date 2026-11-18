# ai-procurement-platform

A full-stack **Next.js + TypeScript + Prisma + PostgreSQL (Neon DB)** web application that automates Purchase Requisition (PR) intake, policy-as-data evaluation, preferred supplier ranking, PO consolidation, and buyer approvals for Corvo Engineering (`PUN1` Bhosari & `CHK1` Chakan).

## Features

- **Conversational Chat Intake & Batch CSV Upload**: Employees raise PRs in plain English (with item matching, relative date parsing, and follow-up prompts for missing fields), or Procurement uploads a PR batch CSV.
- **Policy as Data (Zero-Code Updates)**: Procurement policies—rule order, value limits, clubbing/consolidation windows, and plant/category-specific rules—are stored as versioned JSON in PostgreSQL (`policy_versions`). Amendments can be uploaded as PDF/TXT or typed in plain language, previewed as a diff, and activated from their effective date.
- **Deterministic Decision Engine**:
  - Fuzzy item matching with abbreviation/noise normalization (`NEW` for unknown items).
  - Anti-splitting clubbing (same item + plant, 14-day creation window, ±7-day need-by window).
  - Chronological contract ceiling tracking across register and PDF-only contracts.
  - Ordered rule evaluation (`CAPEX_SOURCING`, `CONTRACT_PO`, `EMERGENCY_PO`, `SPOT_PO`, `RFQ`, `RFP`, `NEW_ITEM_SOURCING`, `NOT_PROCESSED`).
  - 24-hour PO consolidation across requirements sharing supplier, plant, and route.
- **Preferred Supplier Ranking**: Automatically ranks Active suppliers per item as of any chosen date using 548-day PO history, recency tiers, contract history, on-time %, and quality rating, with CSV export (`item_code,rank,supplier_id,reference_price`).
- **Buyer Workspace & Audit Trail**: Displays every requirement with its policy clause, contract/PO reasoning, Approve (`Create PO` / `Start RFQ`), and Override (with mandatory written comment) logged to `buyer_actions`.
- **Contracts Register & PDF Extraction**: Loads `contract_register.csv` and supports adding signed PDF-only contracts via `pdf-parse` or manual entry.

## Tech Stack

- **Frontend & API**: Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- **Database & ORM**: PostgreSQL (Neon DB / Docker Postgres), Prisma ORM
- **Testing & Parsing**: Vitest, `pdf-parse`

## Project Structure

```text
├── prisma/
│   ├── schema.prisma          # PostgreSQL schema (master data, contracts, policies, PRs, audit)
│   └── seed.ts                # Idempotent seed script for master data, Policy v5.0 & sample batch
├── data/                      # Master CSVs, contract register/lines, and sample_pr_batch.csv
├── src/
│   ├── engine/                # Pure TypeScript decision engine (zero DB/HTTP dependencies)
│   │   ├── defaultPolicy.ts   # Policy v5.0 (CORVO-PROC-POL-04) as structured JSON
│   │   ├── itemMatcher.ts     # Abbreviation-aware fuzzy item matcher
│   │   ├── preferredSuppliers.ts
│   │   ├── decisionEngine.ts  # Clubbing, valuation, ceilings, rule evaluation, PO consolidation
│   │   └── types.ts
│   ├── lib/                   # CSV parser, chat intake, policy amendment parser, contract PDF parser
│   └── app/
│       ├── api/               # REST endpoints (/process-batch, /policies, /requirements, etc.)
│       └── page.tsx           # 5-tab Procurement Workbench UI
├── tests/
│   └── decisionEngine.test.ts # Vitest suite validating Worked Examples & edge cases
├── DECISIONS.md               # Documented judgment calls for policy ambiguities
└── APPROACH.md                # Architecture & tooling overview
