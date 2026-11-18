# DECISIONS.md — Judgment Calls & Ambiguity Resolution

This document records every situation where the Procurement Policy v5.0 or data was silent or ambiguous, what we decided, why, and how it is implemented.

## 1. Invalid & Out-of-Scope PR Lines (`NOT_PROCESSED`)
* **What we noticed**:
  * `PR-26-00172/1` has `quantity = 0` (`ITM-1020`, Cutting wheel 14 inch).
  * `PR-26-00173/1` specifies `plant = PUN2`, whereas the policy header explicitly states it applies only to `PUN1` (Bhosari) and `CHK1` (Chakan), and `plants.csv` only contains `PUN1` and `CHK1`.
* **Decision**: Route both to `NOT_PROCESSED` with an explicit reason (`Invalid quantity (0)` and `Plant 'PUN2' is not covered by policy`).
* **Why**: Issuing a zero-quantity PO or routing a PR for an unrecognized plant would create downstream ERP/receiving errors.

## 2. Implicit Urgency in Description (`- urgent`)
* **What we noticed**: Four PR lines (`PR-26-00018`, `PR-26-00023`, `PR-26-00139`, `PR-26-00167`) have `urgency = Normal` in the CSV column, but include `- urgent` in their free-text description.
* **Decision**: Configurable via `policy.clubbing.detectUrgentInDescription` (default `true`): if `/\burgent\b/i` appears in the description, treat the line as `Emergency`.
* **Why**: Requesters often type urgency in free text rather than toggling the dropdown. Making it a policy-as-data flag allows Procurement to disable it if strict column-only behavior is preferred.

## 3. Preferred Supplier Ranking Formula (Policy Section 6.2)
* **What we noticed**: Section 6.2 specifies five factors (PO frequency in 548 days, recency, whether the supplier held a contract for the item, on-time delivery %, and quality rating) and leaves exact weights to system design. Worked Examples p.5 gives three benchmark rankings with recency tiers (`1.0` ≤ 90d, `0.5` ≤ 365d, `0.0` > 365d).
* **Decision**: Weighted composite score:
  $$\text{Score} = (\text{PO Count}_{548d} \times 10) + (\text{Recency} \times 20) + (\text{HasContract} \times 12) + \left(\frac{\text{OnTime\%}}{100} \times 8\right) + \left(\frac{\text{Quality}}{5} \times 6\right)$$
  Ties break by `onTimePct` DESC, then `qualityRating` DESC. Blocked and Inactive suppliers are strictly excluded.
* **Why**: Balances proven volume and recent delivery reliability while giving a meaningful preference to contracted suppliers, and reproduces all three benchmark rankings in `Worked_Examples.pdf` p.5.

## 4. Valuation When Historical POs Are From Blocked/Inactive Suppliers
* **What we noticed**: Policy Section 3.1(b) says "the price on the most recent PO for the item in the 365 days before the requirement date", while Section 5.3/5.4 specifically require an **Active** supplier PO in the last 365 days to allow a direct PO.
* **Decision**: Valuation (3.1b) uses the most recent PO in the 365-day window to establish a fair market unit price estimate, while direct PO eligibility (5.3/5.4) strictly checks for at least one PO from an **Active** supplier in the 365-day window.
* **Why**: Even if a past supplier was later blocked, the historical transaction price is still a better market valuation than falling back to standard price, while Blocked/Inactive suppliers are never awarded or suggested.

## 5. Short Active Supplier Pool for Sourcing Suggestions (Policy Section 6.4)
* **What we noticed**: In `Worked_Examples.pdf` #11 (`ITM-1034`, RFP requiring 5 suggestions), only 4 Active suppliers exist in the `Electrical Spares` category (`S020`, `S017`, `S019`, `S018`).
* **Decision**: Suggest up to `N` (3 or 5) Active suppliers—first from the item's preferred list, then topped up by other Active suppliers in the same category sorted by delivery + quality. Never pad with out-of-category or Blocked/Inactive suppliers.
* **Why**: Respects Rule 5.7 (never suggest Blocked/Inactive) and matches Worked Example #11 (`S020, S017, S019, S018`).

## 6. Near-Duplicate PRs (`PR-26-00174` and `PR-26-00175`)
* **What we noticed**: Raised 4 minutes apart on `2026-11-02` by `S. Patil` at `PUN1` for `ITM-1033` (1 NOS each, same need-by date `2026-11-16`).
* **Decision**: Clubbed into a single requirement (total qty 2) per Section 2.2 rather than silently dropping one, and flagged in the Buyer Workspace so the buyer can verify whether both units are needed before approving.
* **Why**: Silently dropping a PR risks under-ordering, whereas clubbing enforces anti-splitting rules while preserving buyer visibility.

## 7. Item Matching Threshold & New Items
* **What we noticed**: Requesters use abbreviations (`brg`, `hyd`, `pneu`) and noise phrases (`as per sample`, `(repeat)`, `for maintenance`).
* **Decision**: Normalize abbreviations and strip noise tokens before computing token Jaccard + coverage + alphanumeric spec-token overlap, requiring score ≥ `0.58` to match. Genuine new items (`Drinking water purifier 50 LPH`, `Ultrasonic thickness gauge`) score well below `0.58` and route to `NEW_ITEM_SOURCING`.
* **Why**: Prevents false-positive matches on unfamiliar equipment while reliably resolving legitimate shorthand descriptions.
