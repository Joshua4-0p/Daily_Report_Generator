# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The frontend is still just the **scaffold** — a fresh Vite + React + TypeScript + shadcn/ui project with the default template page (`src/App.tsx`). None of the actual Daily Report Generator feature code (pages, forms, API layer, Zustand store, hooks) has been built yet.

The backend has a start: `infrastructure/` now exists as a CDK TypeScript app (sibling directory at repo root — see discrepancy #1 below).

- **Phase 1 (done, deployed):** `ReportsDatabaseStack` (`infrastructure/lib/stacks/database-stack.ts`) is written and deployed to account `396531908858` / `us-east-1` — the `DailyReports` DynamoDB table (on-demand billing, `userId`+`reportId` keys, `DateIndex` GSI) is live.
- **Phase 2 (done, deployed):** all Lambda source is written (`infrastructure/lambda/src/`: `index.ts` router, 4 handlers, 3 utils) and passes `tsc --noEmit`.
- **Phase 3 (done, deployed):** `ReportsApiStack` (`infrastructure/lib/stacks/api-stack.ts`) is deployed — `daily-report-generator` Lambda (Node.js 24.x, 512MB/30s, least-privilege IAM role scoped to the Bedrock model/inference-profile ARNs + the `DailyReports` table) behind an HTTP API at `https://vy201bcogf.execute-api.us-east-1.amazonaws.com`, with all 4 routes registered and curl-verified end to end (generate, save, list, delete, 400 validation). `VITE_API_URL` is set in `.env.local` at the repo root.
- **Bedrock model (live, switched from the default):** quota for Claude Haiku 4.5 was approved, so `BEDROCK_MODEL_ID` is now `us.anthropic.claude-haiku-4-5-20251001-v1:0` (not `amazon.nova-lite-v1:0`, and not a bare model ID — see discrepancy #11 below) and curl-verified working end-to-end.
- **Phase 5 (not started):** `lib/stacks/frontend-stack.ts` is an empty placeholder class only (`TODO` stub) — no Amplify hosting exists yet.

Five planning documents at the repo root describe the intended build and are the source of truth for scope and design decisions — read the relevant one before implementing in that area, and treat them as the plan rather than assuming the code already matches them:

- `structure.md` — the master build plan: full tech stack table, the originally-intended directory layout, and an ordered phase-by-phase build sequence (Phase 0 env setup → Phase 1 CDK/DB stack → Phase 2 Lambda → Phase 3 API Gateway → Phase 4 frontend scaffold → Phase 5 frontend/backend integration → Phase 6 Amplify deploy → Phase 7 article/submission). Treat the phase order as the recommended build sequence when picking up new work.
- `daily_report_generator_srs.md` — requirements (functional/non-functional), AWS services used, cost targets, scope boundaries (no auth/PDF export/email in MVP)
- `daily_report_generator_frontend.md` — frontend build spec: page layouts, exact shadcn components per page, Tailwind color tokens, Zustand store shape, TypeScript types, API client shape, React Router setup
- `daily_report_generator_cloud_infrastructure.md` — AWS CDK build guide: stack structure (database/api/frontend stacks), DynamoDB table design, Lambda handler layout
- `cloud_architecture_diagram.md` — describes the 3-tier serverless architecture (Amplify → API Gateway → Lambda → Bedrock/DynamoDB) for diagramming purposes
- `daily_report_generator_article_structure.md` — structure for the write-up accompanying the challenge submission (not implementation guidance)

**Discrepancies between the docs and the actual scaffold — trust the code, not the doc prose:**

1. **Directory layout.** `structure.md` (and the other docs) describe a monorepo with sibling `frontend/` and `infrastructure/` directories, each with their own `package.json`, under a `daily-report-generator/` root. The actual repo only half-matches that now: the Vite app still lives directly at the repo root (`src/`, `package.json`, `vite.config.ts` are all at the top level, not under `frontend/`), but `infrastructure/` **does** now exist as a sibling directory at the repo root with its own `package.json` (CDK app) and an `infrastructure/lambda/` subdirectory with its own `package.json` (Lambda code) — this matches the docs' `infrastructure/` layout, just without the `frontend/` wrapper on the other side.
2. **Package versions.** The docs were written against React 18 / Tailwind v3 / a `tailwind.config.ts` file, but the actual scaffold installed in `package.json` uses **React 19, Tailwind v4, and shadcn's newer CSS-first config** (no `tailwind.config.ts`; `components.json` uses `style: "base-nova"` and Tailwind config lives in `src/index.css`). When implementing UI from the frontend spec, follow the versions actually in `package.json`/`components.json` — e.g. add shadcn components via `npx shadcn@latest add <name>` (already done for: badge, button, card, dialog, input, label, select, separator, skeleton, sonner, table, textarea, tooltip) rather than hand-authoring `tailwind.config.ts`.
3. **Unpinned `typescript` in `infrastructure/lambda`** resolved to **TypeScript 7.0.2** (not the 5.x the doc assumes) — this version does not auto-include ambient `Node`/`aws-lambda` globals the way older TS did, so `infrastructure/lambda/tsconfig.json` needs an explicit `"types": ["node", "aws-lambda"]` or you'll get `Cannot find name 'process'/'Buffer'` errors. Also needed `@types/aws-lambda` as a dev dependency (the doc's install command omits it) since the handlers import `APIGatewayProxyEventV2`/`APIGatewayProxyStructuredResultV2` from the `aws-lambda` package.
4. **Do not install `@aws-cdk/aws-lambda-nodejs` as a separate package** even though `daily_report_generator_cloud_infrastructure.md` lists it — that's CDK v1 syntax. In the installed CDK v2 (`aws-cdk-lib` ^2.260, via `cdk init`), `NodejsFunction` already ships inside `aws-cdk-lib/aws-lambda-nodejs`; only `esbuild` needs installing separately (for bundling).
5. **`cdk.json`'s generated `context` block** (from `cdk init` with CDK 2.1128) has ~90 feature flags, a superset of — and in some cases a replacement for — the 2 flags the doc's minimal `cdk.json` example shows (e.g. `@aws-cdk/core:stackRelativeExports` no longer exists as a flag). Keep the CDK-generated block; don't replace it with the doc's version.
6. **`cdk synth`/`cdk deploy` via the plain `npx cdk ...` invocation can OOM on this machine** (low free RAM causes `ts-node`'s full type-check pass on `aws-cdk-lib` to run out of memory) — work around it by running `tsc --noEmit` first to confirm types, then invoking cdk with `--app "npx ts-node --transpile-only --prefer-ts-exts bin/app.ts"` to skip the redundant second type-check.
7. **Do not list AWS SDK v3 packages in `NodejsFunction`'s `bundling.nodeModules`** even though the doc's Phase 3 code does — combined with `externalModules: []` it tells esbuild to exclude those packages from the bundle and instead has CDK run `npm ci` against `infrastructure/lambda/package-lock.json` in the staged asset, which fails (`EUSAGE`, lockfile out of sync with the deep AWS SDK v3 dependency tree). Omit `nodeModules` entirely so esbuild inlines everything into one self-contained `index.mjs`.
8. **`OutputFormat.ESM` bundling needs a `require` shim or the Lambda crashes at cold start** with `Dynamic require of "node:stream" is not supported` (AWS SDK v3's dependency chain does a dynamic `require()` of Node builtins, and ESM has no native `require`). Fix: add `banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"` to the `bundling` config.
9. **Git Bash on Windows mangles `/aws/lambda/...`-style CLI arguments** (MSYS2 path conversion rewrites them as Windows paths before the AWS CLI sees them), breaking commands like `aws logs tail /aws/lambda/<name>` with a confusing `InvalidParameterException` on `logGroupName`. Prefix with `MSYS_NO_PATHCONV=1` when running AWS CLI commands that take a leading-slash resource name from Bash.
10. **The frontend env files live at the repo root, not under a `frontend/` directory** — `.env.local` (gitignored via `*.local`) and `.env.example` are next to `vite.config.ts` at the top level, consistent with discrepancy #1 (no `frontend/` wrapper exists). `VITE_API_URL` in `.env.local` is currently set to the deployed `ReportsApiStack` output.
11. **Claude Haiku 4.5 cannot be invoked by its bare foundation-model ID** — unlike Nova Lite, calling `ConverseCommand` with `modelId: "anthropic.claude-haiku-4-5-20251001-v1:0"` directly returns `ValidationException: ... on-demand throughput isn't supported ... use an inference profile`. Use the cross-region inference profile ID instead (`us.anthropic.claude-haiku-4-5-20251001-v1:0` — confirmed via `aws bedrock list-inference-profiles`), and grant the Lambda IAM role `bedrock:InvokeModel`/`bedrock:Converse` on **both** the inference-profile ARN (`arn:aws:bedrock:<region>:<account>:inference-profile/us.anthropic...`) **and** the underlying foundation-model ARNs in the profile's 3 source regions (us-east-1, us-east-2, us-west-2) — the profile fans out to whichever region is available, so permission on the profile ARN alone isn't sufficient.
12. **Claude Haiku 4.5 rejects a Converse request that sets both `temperature` and `topP`** in `inferenceConfig` (`ValidationException: temperature and top_p cannot both be specified`), even though Nova Lite accepts both simultaneously. `infrastructure/lambda/src/utils/bedrock.ts` sets only `temperature` (not `topP`) so the same code path works across both models — this is exactly the kind of per-model incompatibility NFR-07's "swap the env var, no code changes" promise doesn't fully cover; re-check inference-config compatibility whenever switching to a new model.

## Project constraints (from the planning docs)

- **AWS account/region:** `396531908858` / `us-east-1` (broadest Bedrock model availability) — used throughout the CDK docs for `cdk bootstrap` and stack `env`.
- **Cost target:** total AWS spend must stay under $10/month at MVP usage (~3,000 reports/month); drives choices like DynamoDB on-demand billing, API Gateway HTTP API (not REST API), and no Bedrock streaming.
- **Bedrock model:** env-var driven (`BEDROCK_MODEL_ID`). Originally defaulted to `amazon.nova-lite-v1:0` (generally available, no quota request needed); Claude Haiku 4.5 quota has since been approved and the deployed Lambda now actually uses `us.anthropic.claude-haiku-4-5-20251001-v1:0` (see discrepancies #11–12 for the inference-profile ARN and inference-config gotchas that came with that switch — it wasn't purely an env-var change).
- **Lambda sizing:** 512 MB memory, 30s timeout (kept low deliberately as part of the cost guard).
- This is a weekend-challenge submission (AWS Builder Center "Weekend Productivity Challenge") with a submission deadline — see `structure.md` Phase 7 and `daily_report_generator_article_structure.md` for the article/write-up requirements.

## Commands

```bash
npm run dev        # start Vite dev server
npm run build      # tsc -b (project references) + vite build
npm run typecheck  # tsc --noEmit only
npm run lint       # eslint .
npm run format     # prettier --write "**/*.{ts,tsx}"
npm run preview    # preview production build
```

There is no test runner configured — do not assume Jest/Vitest exist.

## Architecture notes

# AWS Guidance

- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available.
  Load the skill with `retrieve_skill` and prefer its guidance over
  general knowledge.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.

## Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.

- Path alias `@/*` → `./src/*` (configured in both `tsconfig.app.json` and `vite.config.ts`; keep them in sync if changed).
- `tsconfig.json` is a solution file only (`references` to `tsconfig.app.json` and `tsconfig.node.json`); app source compiler options live in `tsconfig.app.json`.
- Styling is Tailwind v4 via the `@tailwindcss/vite` plugin (no PostCSS config, no `tailwind.config.ts`) — theme tokens and `@layer` rules live in `src/index.css`.
- shadcn/ui components are generated into `src/components/ui/` — treat these as generated/vendored code (regenerate via the CLI rather than hand-editing structure) but they can be styled/extended in place per shadcn convention.
- `src/components/theme-provider.tsx` is a hand-rolled dark/light/system theme provider (localStorage-persisted, syncs across tabs via the `storage` event, and binds a `d` key shortcut to toggle theme — skipped when focus is in an editable field). It wraps `App` in `main.tsx`. There is no dependency on `next-themes` for this despite it being listed in `package.json`.
- Per the frontend spec, once built out the app will be organized as `pages/` (Home, Generator, History), `components/report/`, `components/layout/`, `hooks/` (TanStack Query), `store/useUIStore.ts` (Zustand), `types/report.ts`, and `api/reports.ts` (Axios client reading `VITE_API_URL`). None of these exist yet — create them per the frontend doc when implementing each page.
- The backend is a single Lambda function behind an HTTP API (API Gateway), calling Bedrock's Converse API (model ID from an env var, defaulting to `amazon.nova-lite-v1:0`) and reading/writing a single DynamoDB table (`userId` partition key, `reportId` sort key, GSI on date). All AWS resources target `us-east-1` and are deployed (see Project status above); only Amplify hosting (Phase 5, `frontend-stack.ts`) remains a placeholder.
