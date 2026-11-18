# APPROACH.md — Architecture & AI Tool Usage

## Architecture
* **Stack**: Next.js 14 (App Router) + TypeScript + PostgreSQL (Neon DB) with Prisma ORM + Tailwind CSS.
* **Zero-Dependency Deterministic Core**:
  * `src/engine/` holds the pure TypeScript decision engine (`decisionEngine.ts`, `itemMatcher.ts`, `preferredSuppliers.ts`, `defaultPolicy.ts`), completely decoupled from Prisma and HTTP.
  * `src/lib/chatIntake.ts` uses deterministic NLP (keyword, date, plant, quantity, and fuzzy item-master matching) with quick-start default prompts—requiring no external LLM keys.
  * `src/lib/policyParser.ts` parses plain-text or PDF policy amendments into versioned `PolicyConfig` JSON drafts, shows a plain-language diff, and includes an inline JSON rule editor before activation.
* **Database (`prisma/schema.prisma`)**: Stores master data, contracts (register + PDF-only), versioned policies (`policy_versions`), PR batches/lines, grouped requirements, and buyer audit actions (`buyer_actions`).

## AI Tools Used
* Used an AI coding assistant during development to scaffold the Next.js/Prisma/TypeScript codebase, design the Policy-as-Data schema, and write Vitest test cases.
* Inside the running application, all chat intake, item matching, policy parsing, and PDF contract extraction run deterministically with zero external AI API dependencies.
