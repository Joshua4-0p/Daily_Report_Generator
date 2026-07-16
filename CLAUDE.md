# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The frontend is still just the **scaffold** — a fresh Vite + React + TypeScript + shadcn/ui project with the default template page (`src/App.tsx`). None of the actual Daily Report Generator feature code (pages, forms, API layer, Zustand store, hooks) has been built yet.

The backend has a start: `infrastructure/` now exists as a CDK TypeScript app (sibling directory at repo root — see discrepancy #1 below).

- **Phase 1 (done, deployed):** `ReportsDatabaseStack` (`infrastructure/lib/stacks/database-stack.ts`) is written and deployed to account `396531908858` / `us-east-1` — the `DailyReports` DynamoDB table (on-demand billing, `userId`+`reportId` keys, `DateIndex` GSI) is live.
- **Phase 2 (done, deployed):** all Lambda source is written (`infrastructure/lambda/src/`: `index.ts` router, 4 handlers, 3 utils) and passes `tsc --noEmit`.
- **Phase 3 (done, deployed):** `ReportsApiStack` (`infrastructure/lib/stacks/api-stack.ts`) is deployed — `daily-report-generator` Lambda (Node.js 24.x, 512MB/30s, least-privilege IAM role scoped to the Bedrock model/inference-profile ARNs + the `DailyReports` table) behind an HTTP API at `https://vy201bcogf.execute-api.us-east-1.amazonaws.com`, with all 4 routes registered and curl-verified end to end (generate, save, list, delete, 400 validation). `VITE_API_URL` is set in `.env.local` at the repo root.
- **Bedrock model (live, switched from the default):** quota for Claude Haiku 4.5 was approved, so `BEDROCK_MODEL_ID` is now `us.anthropic.claude-haiku-4-5-20251001-v1:0` (not `amazon.nova-lite-v1:0`, and not a bare model ID — see discrepancy #11 below) and curl-verified working end-to-end.
- **Phase 3.5 (done, deployed):** `daily_report_generator_srs.md` was upgraded to v2.0 (auth, company branding, dashboard, PDF templates — see the constraints section below) and an auth/storage phase was inserted between Phase 3 and Phase 4. Added: `ReportsAuthStack` (`lib/stacks/auth-stack.ts` — Cognito User Pool `daily-report-users` + web client, no secret, 1h access/ID token, 30d refresh), `ReportsStorageStack` (`lib/stacks/storage-stack.ts` — private S3 bucket `daily-report-logos-396531908858` for logo uploads via pre-signed URLs), a `UserProfiles` DynamoDB table (PK `userId` = Cognito sub, added to `database-stack.ts`), and 3 new Lambda handlers (`getUploadUrl`, `saveProfile`, `getProfile`). **Every** `/api/*` route (old and new) now requires a valid Cognito JWT via an `HttpJwtAuthorizer` — curl-verified: authenticated calls succeed, unauthenticated calls get a `401` from API Gateway itself without the Lambda ever being invoked (confirmed via CloudWatch — 0 additional `START RequestId` lines for the unauthenticated test). A test Cognito user exists for manual testing: `test@example.com` / `Test@1234` (sub `d4680448-b061-70a2-4928-d3a3c5606f32`) in pool `us-east-1_hLqCUOd8R`.
- **Known gap going into Phase 4:** the original 4 report handlers (`generateReport`, `saveReport`, `getHistory`, `deleteReport`) are now behind the JWT authorizer but their *internal* logic is unchanged from Phase 2/3 — they still expect `employeeName` in the request body/query params and derive `userId` by normalizing it, rather than reading `userId` from `event.requestContext.authorizer.jwt.claims.sub` the way the 3 new profile/upload handlers do. SRS v2.0 FR-01 expects employee name/department/company to come from the authenticated user's profile, not be re-entered — reconciling this (switching the 4 report handlers to derive `userId` from the JWT, matching profile handlers) is unstarted work, likely to land whenever the frontend integration makes it obvious which fields the UI still needs to send.
- **`daily_report_generator_frontend.md` has been updated in place to v2.0** (no separate `_v2.md` file exists — the user overwrote the original file's content). It now covers: 2 route groups (public: `/`, `/register`, `/login`, `/verify`; authenticated: `/dashboard`, `/generator`, `/template`, `/history`, `/profile` behind a sidebar layout), `aws-amplify` v6 for Cognito auth (`src/lib/amplify.ts`, `useAuth.ts`, an Axios JWT interceptor), `@react-pdf/renderer` v3 for 4 client-side PDF templates (Classic/Professional/Modern/Corporate), and `react-dropzone` for logo upload. None of `aws-amplify`, `@react-pdf/renderer`, or `react-dropzone` are installed in `package.json` yet.
- **Phase 5 (not started):** `lib/stacks/frontend-stack.ts` is an empty placeholder class only (`TODO` stub) — no Amplify hosting exists yet.

Five planning documents at the repo root describe the intended build and are the source of truth for scope and design decisions — read the relevant one before implementing in that area, and treat them as the plan rather than assuming the code already matches them:

- `structure.md` — the master build plan: full tech stack table, the originally-intended directory layout, and an ordered phase-by-phase build sequence (Phase 0 env setup → Phase 1 CDK/DB stack → Phase 2 Lambda → Phase 3 API Gateway → Phase 4 frontend scaffold → Phase 5 frontend/backend integration → Phase 6 Amplify deploy → Phase 7 article/submission). Treat the phase order as the recommended build sequence when picking up new work.
- `daily_report_generator_srs.md` — **now v2.0** (upgraded from the original v1.0 MVP): adds Cognito auth, S3 company-logo branding, 4 downloadable PDF templates, and a dashboard on top of the original report-generation/history/delete scope. Still the source of truth for AWS services, cost targets, and FR/NFR numbers — just check the version header before assuming which scope applies.
- `daily_report_generator_frontend.md` — **now v2.0** (updated in place, same filename): 9-page frontend build spec with Cognito auth flows, sidebar-based authenticated layout, dashboard metrics, a 4-template PDF picker, and profile/branding management, superseding the original 3-page v1 spec entirely.
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
13. **The Phase 3.5 cloud-infra doc's own JWT-authorizer snippet references `userPoolClient.userPoolClientId` without ever putting `userPoolClient` in `ReportsApiStackProps`** (the doc even admits this in a `NOTE` comment). Fixed by adding `userPoolClient: cognito.UserPoolClient` to the props interface (alongside `userPool`) and passing `authStack.userPoolClient` through from `bin/app.ts` — don't reintroduce the bare unresolvable variable if re-deriving this stack from the doc.
14. **All Lambda handler/router event types were unified to `APIGatewayProxyEventV2WithJWTAuthorizer`** (from `@types/aws-lambda`), not the plain `APIGatewayProxyEventV2` used in Phases 2–3 — every route now sits behind the Cognito JWT authorizer, so `event.requestContext.authorizer.jwt.claims.sub` is always the correct/typed way to get the caller's Cognito `sub`. The plain type lacks `.jwt` on `requestContext.authorizer` and would not compile against the new profile handlers.

## Project constraints (from the planning docs)

- **AWS account/region:** `396531908858` / `us-east-1` (broadest Bedrock model availability) — used throughout the CDK docs for `cdk bootstrap` and stack `env`.
- **AWS services (7, per SRS v2.0):** Amplify, Cognito, S3, API Gateway (HTTP API), Lambda, Bedrock, DynamoDB (two tables: `DailyReports` + `UserProfiles`). Cost target: total AWS spend must stay under $10/month at ~3,000 reports/month, 50 users; drives choices like DynamoDB on-demand billing, HTTP API (not REST API), no Bedrock streaming, and client-side PDF rendering (no server cost).
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
- Per the v2.0 frontend spec, once built out the app will be organized as `api/` (Axios client + JWT interceptor), `components/layout/` (public `Navbar` + `AuthenticatedLayout` sidebar), `components/templates/` (4 `@react-pdf/renderer` PDF templates + a selector), `components/shared/` (`ProtectedRoute`/`PublicRoute`), `hooks/` (`useAuth`, TanStack Query hooks), `lib/amplify.ts` + `lib/parseReport.ts`, `pages/` (`Home`, `Register`, `VerifyEmail`, `Login`, `Dashboard`, `Generator`, `TemplatePicker`, `History`, `Profile`), `store/useUIStore.ts` (Zustand — now also holds `userProfile` and `selectedTemplate`), and `types/` (`report.ts`, `template.ts`, `user.ts`). None of these exist yet — the doc's directory tree is written under a `frontend/src/` prefix that doesn't apply here (see discrepancy #1); everything lands under the repo-root `src/` instead.
- The backend is a single Lambda function behind an HTTP API (API Gateway) with a Cognito JWT authorizer on every route, calling Bedrock's Converse API (model ID from an env var, currently `us.anthropic.claude-haiku-4-5-20251001-v1:0`) and reading/writing two DynamoDB tables (`DailyReports`: `userId`+`reportId` keys, `DateIndex` GSI; `UserProfiles`: `userId` PK only) plus an S3 bucket for logo uploads via pre-signed URLs. All AWS resources target `us-east-1` and are deployed (see Project status above); only Amplify hosting (Phase 5, `frontend-stack.ts`) remains a placeholder. `VITE_API_URL`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_LOGOS_BUCKET`, and `VITE_AWS_REGION` are all set in `.env.local` at the repo root.
