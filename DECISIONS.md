# DECISIONS.md — Judgment Calls & Ambiguity Resolution

This document records every situation where the Procurement Policy v5.0 or data was silent or ambiguous, what we decided, why, and how it is implemented.

## 1. Invalid & Out-of-Scope PR Lines (`NOT_PROCESSED`)
* **What we noticed**:
  * Zero-quantity lines (e.g., `PR-26-00172/1` in sample, `PR-26-00674/1` in blind batch) have `quantity = 0`.
  * Out-of-scope plant lines (e.g., `PR-26-00173/1`, `PR-26-00675/1`) specify `plant = PUN2`, whereas the policy header applies only to `PUN1` (Bhosari) and `CHK1` (Chakan), and `plants.csv` contains only `PUN1` and `CHK1`.
* **Decision**: Route both to `NOT_PROCESSED` with an explicit reason (`Invalid quantity (0)` and `Plant 'PUN2' is not covered by policy`).
* **Why**: Issuing a zero-quantity PO or routing a PR for an unrecognized plant would cause downstream ERP/receiving failures.

## 2. Implicit Urgency in Description (`- urgent`)
* **What we noticed**: Several PR lines have `urgency = Normal` in the CSV column, but include `- urgent` in their free-text description.
* **Decision**: Configurable via `policy.clubbing.detectUrgentInDescription` (default `true`): if `/\burgent\b/i` appears in the description, treat the line as `Emergency`.
* **Why**: Requesters often type urgency in free text rather than toggling the dropdown. Making it a policy-as-data flag allows Procurement to disable it if strict column-only behavior is preferred.

## 3. Preferred Supplier Ranking Formula (Policy Section 6.2)
* **What we noticed**: Section 6.2 specifies five factors (PO frequency in 548 days, recency, whether the supplier held a contract for the item, on-time delivery %, and quality rating) and leaves exact weights to system design. `Worked_Examples.pdf` p.5 gives three benchmark rankings with recency tiers (`1.0` ≤ 90d, `0.5` ≤ 365d, `0.0` > 365d).
* **Decision**: Weighted composite score:
  `Score = (PO_Count_548d × 10) + (Recency × 20) + (HasContract × 12) + ((OnTime% / 100) × 8) + ((Quality / 5) × 6)`
  Ties break by `onTimePct` DESC, then `qualityRating` DESC. Blocked and Inactive suppliers are strictly excluded.
* **Why**: Balances proven order volume and recent delivery reliability while giving a meaningful preference to contracted suppliers, and reproduces all three benchmark rankings in `Worked_Examples.pdf` p.5.

## 4. Valuation When Historical POs Are From Blocked/Inactive Suppliers
* **What we noticed**: Policy Section 3.1(b) says "the price on the most recent PO for the item in the 365 days before the requirement date", while Section 5.3/5.4 require an **Active** supplier PO in the last 365 days to allow a direct PO.
* **Decision**: Valuation (3.1b) uses the most recent PO in the 365-day window to establish a fair market unit price estimate, while direct PO eligibility (5.3/5.4) strictly checks for at least one PO from an **Active** supplier in the 365-day window.
* **Why**: Historical transaction prices remain a valid market valuation benchmark even if a past supplier was later blocked, while Blocked/Inactive suppliers are never awarded or suggested.

## 5. Short Active Supplier Pool for Sourcing Suggestions (Policy Section 6.4)
* **What we noticed**: In `Worked_Examples.pdf` #11 (`ITM-1034`, RFP requiring 5 suggestions), only 4 Active suppliers exist in the `Electrical Spares` category (`S020`, `S017`, `S019`, `S018`).
* **Decision**: Suggest up to `N` (3 or 5) Active suppliers—first from the item's preferred list, then topped up by other Active suppliers in the same category sorted by delivery + quality. Never pad with out-of-category or Blocked/Inactive suppliers.
* **Why**: Respects Rule 5.7 (never suggest Blocked/Inactive) and matches Worked Example #11 (`S020, S017, S019, S018`).

## 6. Near-Duplicate PRs
* **What we noticed**: Some PRs are raised minutes apart by the same requester at the same plant for the same item and need-by date (e.g., `PR-26-00174` & `PR-26-00175`, `PR-26-00676` & `PR-26-00677`).
* **Decision**: Clubbed into a single requirement per Section 2.2 rather than silently dropping one, keeping full visibility in the Buyer Workspace so a buyer can verify before approving.
* **Why**: Silently dropping a PR risks under-ordering, whereas clubbing enforces anti-splitting rules while preserving buyer review.

## 7. Item Matching Threshold & New Items
* **What we noticed**: Requesters use abbreviations (`brg`, `hyd`, `pneu`) and noise phrases (`as per sample`, `(repeat)`, `for maintenance`).
* **Decision**: Normalize abbreviations and strip noise tokens before computing token Jaccard + coverage + alphanumeric spec-token overlap, requiring score ≥ `0.58` to match. Genuine new items (e.g., `Drinking water purifier 50 LPH`, `Ultrasonic thickness gauge`, `Thermal imaging camera for maintenance`) score well below `0.58` and route to `NEW_ITEM_SOURCING`.
* **Why**: Prevents false-positive matches on unfamiliar equipment while reliably resolving legitimate shorthand descriptions.

## 8. Policy-as-Data Amendment Workflow (Upload + Preview/Edit)
* **How it works**: In the **Policy as Data** tab, Procurement can upload a signed amendment PDF/TXT or describe changes in plain text. The app extracts PDF text via `pdf-parse`, auto-parses standard version, effective-date, and threshold updates into a `DRAFT` record in `policy_versions`, and displays a plain-language change summary.
* **Why "Edit Rules JSON" is included in the Draft preview**: To keep the application deterministic with zero external AI/LLM API dependencies, the **Edit Rules JSON** toggle allows Procurement to review and fine-tune multi-condition rules or exact rule ordering (such as Amendment 1's category-specific `Packaging` Spot PO cap and `5.2A` `CHK1` Electrical Spares rule placed immediately after `5.2`) directly in the UI before clicking **Approve & Activate + Reprocess Batch**—with zero code changes.
* **Batch Reprocessing**: Activating a new policy version automatically reprocesses the latest PR batch in the Buyer Workspace while preserving earlier batches' historical snapshots.
