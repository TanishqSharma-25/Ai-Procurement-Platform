# Corvo Engineering — Policy-Driven PR-to-PO Workbench

Full-stack **Next.js + Prisma + PostgreSQL (Neon DB) + TypeScript** application for Corvo Engineering.

## Quick Start (Neon DB + PowerShell / Terminal)

1. Create `.env` with your Neon connection string:
   ```env
   DATABASE_URL="postgresql://<user>:<password>@<neon-host>/<dbname>?sslmode=require"
   ```
2. Install, push schema, seed, test, and run:
   ```bash
   npm install
   npx prisma db push
   npm run db:seed
   npm test
   npm run dev
   ```
3. Open **http://localhost:3000**.

## Docker Compose (Optional)
```bash
docker compose up --build
```

## Key API Endpoints
* `POST /api/process-batch` — Process a PR batch CSV and return JSON + Section 4 CSV (`?format=csv`).
* `GET /api/process-batch?batchId=1&format=csv` — Export decisions CSV for a batch.
* `GET /api/preferred-suppliers?asOf=2026-11-01&format=csv` — Export top-3 preferred suppliers per item (`item_code,rank,supplier_id,reference_price`).
* `POST /api/policies` & `PATCH /api/policies` — Propose (PDF/TXT/text), preview, and activate versioned policies.
* `POST /api/contracts` — Add PDF-only contracts (auto-extracted via `pdf-parse` or manual entry).
* `POST /api/requirements` — Buyer Approve or Override (with required comment and audit log).
