# Daily Report Generator — Project Build Plan

## Overview

A personal AI-powered productivity tool that converts plain-text daily work notes into structured, professional daily reports. Workers type freely in plain language, and the AI formats the output into a standard company report format covering tasks completed, plans for tomorrow, and challenges encountered.

Built with React + Vite (TypeScript) on the frontend and AWS serverless infrastructure (Lambda + API Gateway + Bedrock + DynamoDB) on the backend. Infrastructure is provisioned using AWS CDK (TypeScript).

---

## Tech Stack

### Frontend
| Package | Version | Purpose |
|---|---|---|
| react | ^18.3.x | UI library |
| react-dom | ^18.3.x | DOM rendering |
| vite | ^5.x | Build tool |
| typescript | ^5.x | Type safety |
| tailwindcss | ^3.4.x | Utility CSS (shadcn-compatible version) |
| @shadcn/ui | latest | Component library |
| react-router-dom | ^6.x | Client-side routing |
| zustand | ^4.x | UI/global state management |
| @tanstack/react-query | ^5.x | Server state + API calls |
| react-hook-form | ^7.x | Form management (required by shadcn Form) |
| @hookform/resolvers | ^3.x | Zod integration for forms |
| zod | ^3.x | Schema validation |
| date-fns | ^3.x | Date formatting |
| sonner | ^1.x | Toast notifications (shadcn uses this) |
| lucide-react | ^0.x | Icon library (used by shadcn) |
| axios | ^1.x | HTTP client for API calls |
| clsx | ^2.x | Conditional class merging |
| tailwind-merge | ^2.x | Merge Tailwind classes safely |

> Remove: no extra unnecessary packages beyond these.

### Backend / Cloud (AWS)
| Service | Role |
|---|---|
| AWS CDK (TypeScript) | Infrastructure as Code |
| AWS Lambda (Node.js 24.x) | Serverless API handler |
| Amazon API Gateway (HTTP API) | REST endpoint exposure |
| Amazon Bedrock | AI report generation |
| Amazon DynamoDB | Report history storage |
| AWS Amplify | Frontend hosting + CI/CD |

### AWS SDK (inside Lambda)
- `@aws-sdk/client-bedrock-runtime` v3 — Converse API for model-agnostic AI calls
- `@aws-sdk/client-dynamodb` v3 — DynamoDB operations
- `@aws-sdk/util-dynamodb` v3 — DynamoDB marshalling helpers

---

## Project Directory Structure

```
daily-report-generator/
├── frontend/                        # React + Vite app
│   ├── public/
│   ├── src/
│   │   ├── api/
│   │   │   └── reports.ts           # Axios API calls (generate, history, delete)
│   │   ├── components/
│   │   │   ├── ui/                  # shadcn auto-generated components
│   │   │   ├── layout/
│   │   │   │   ├── Navbar.tsx
│   │   │   │   └── Footer.tsx
│   │   │   ├── report/
│   │   │   │   ├── ReportForm.tsx   # Input form component
│   │   │   │   ├── ReportOutput.tsx # Generated report display
│   │   │   │   └── ReportCard.tsx   # History list card
│   │   │   └── shared/
│   │   │       ├── CopyButton.tsx
│   │   │       └── EmptyState.tsx
│   │   ├── hooks/
│   │   │   ├── useGenerateReport.ts # TanStack mutation for POST /generate
│   │   │   └── useReportHistory.ts  # TanStack query for GET /reports
│   │   ├── pages/
│   │   │   ├── Home.tsx
│   │   │   ├── Generator.tsx
│   │   │   └── History.tsx
│   │   ├── store/
│   │   │   └── useUIStore.ts        # Zustand: sidebar, theme, draft state
│   │   ├── types/
│   │   │   └── report.ts            # TypeScript types
│   │   ├── lib/
│   │   │   └── utils.ts             # cn() helper + misc utils
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── env.d.ts
│   ├── .env.example
│   ├── .env.local                   # VITE_API_URL=<gateway url>
│   ├── index.html
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── infrastructure/                  # AWS CDK project
│   ├── bin/
│   │   └── app.ts                   # CDK entry point
│   ├── lib/
│   │   ├── stacks/
│   │   │   ├── database-stack.ts    # DynamoDB
│   │   │   ├── api-stack.ts         # Lambda + API Gateway
│   │   │   └── frontend-stack.ts    # Amplify
│   │   └── constructs/
│   │       └── bedrock-lambda.ts    # Reusable Lambda construct
│   ├── lambda/
│   │   ├── src/
│   │   │   ├── index.ts             # Lambda router (single function)
│   │   │   ├── handlers/
│   │   │   │   ├── generateReport.ts
│   │   │   │   ├── getHistory.ts
│   │   │   │   └── deleteReport.ts
│   │   │   └── utils/
│   │   │       ├── bedrock.ts       # Converse API wrapper
│   │   │       ├── dynamodb.ts      # DynamoDB CRUD helpers
│   │   │       └── promptBuilder.ts # AI prompt construction
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── cdk.json
│   ├── package.json
│   └── tsconfig.json
│
├── .gitignore
└── README.md
```

---

## Build Phases Overview

| Phase | What Gets Built | Estimated Time |
|---|---|---|
| 0 | Environment setup + project init | 30 min |
| 1 | CDK project + database stack (DynamoDB) | 45 min |
| 2 | Lambda function (report generation logic) | 1.5 hrs |
| 3 | API Gateway stack + deploy backend | 30 min |
| 4 | Frontend scaffold + all pages | 2 hrs |
| 5 | Frontend ↔ backend integration | 30 min |
| 6 | Amplify deploy + end-to-end test | 45 min |
| 7 | Article writing + submission | 1.5 hrs |

---

## Phase 0 — Environment Setup

### Prerequisites Check
```bash
node --version        # Must be >= 20.x (24.x preferred to match Lambda runtime)
npm --version
aws --version         # AWS CLI configured
cdk --version         # AWS CDK CLI installed globally
```

If CDK not installed:
```bash
npm install -g aws-cdk
```

### Verify AWS credentials
```bash
aws sts get-caller-identity
# Should return your account ID: 396531908858, region: us-east-1
```

### Bootstrap CDK (only needed once per account/region)
```bash
cdk bootstrap aws://396531908858/us-east-1
```

---

## Phase 1 — CDK Project Initialization

```bash
mkdir daily-report-generator && cd daily-report-generator
mkdir infrastructure && cd infrastructure
cdk init app --language typescript
mkdir -p lib/stacks lib/constructs lambda/src/handlers lambda/src/utils
```

Install Lambda dependencies inside the `lambda/` folder:
```bash
cd lambda
npm init -y
npm install @aws-sdk/client-bedrock-runtime @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb
npm install -D typescript @types/node esbuild
```

Deploy database stack first:
```bash
cd .. && cdk deploy ReportsDatabaseStack
```

Note the DynamoDB table name from stack outputs — it gets passed as env var to Lambda.

---

## Phase 2 — Lambda Development

Write all handlers inside `infrastructure/lambda/src/`. Build and bundle with esbuild before Lambda deployment. Key logic:

- `generateReport.ts` — calls Bedrock Converse API, saves result to DynamoDB, returns formatted report
- `getHistory.ts` — queries DynamoDB by date (GSI), returns list of past reports
- `deleteReport.ts` — deletes a report by `reportId`
- `promptBuilder.ts` — constructs the AI prompt, handles edge case where no challenge is mentioned
- `bedrock.ts` — wraps ConverseCommand, reads model ID from `process.env.BEDROCK_MODEL_ID`

Model selection (via environment variable):
```
BEDROCK_MODEL_ID=amazon.nova-lite-v1:0          # Default (generally available)
# Switch to below when Haiku 4.5 quota is approved:
BEDROCK_MODEL_ID=anthropic.claude-haiku-4-5:0
```

Deploy API stack (Lambda + API Gateway):
```bash
cdk deploy ReportsApiStack
```

Note the API Gateway URL from outputs — this becomes `VITE_API_URL` in the frontend.

---

## Phase 3 — Frontend Initialization

```bash
cd ../../   # back to project root
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Install all dependencies:
```bash
npm install react-router-dom @tanstack/react-query zustand zod react-hook-form \
  @hookform/resolvers date-fns sonner lucide-react axios clsx tailwind-merge
```

Initialize shadcn:
```bash
npx shadcn@latest init
# Choose: TypeScript, Default style, CSS variables
```

Add required shadcn components:
```bash
npx shadcn@latest add button input textarea card badge separator \
  form label dialog table select skeleton tooltip sonner
```

---

## Phase 4 — Frontend Development

Build pages in this order (each integrates progressively):

1. `lib/utils.ts` — `cn()` helper
2. `types/report.ts` — TypeScript interfaces
3. `store/useUIStore.ts` — Zustand store
4. `components/layout/Navbar.tsx` + `Footer.tsx`
5. `pages/Home.tsx` — Landing page
6. `api/reports.ts` — Axios API layer with `VITE_API_URL`
7. `hooks/useGenerateReport.ts` + `hooks/useReportHistory.ts`
8. `components/report/ReportForm.tsx`
9. `components/report/ReportOutput.tsx`
10. `pages/Generator.tsx`
11. `components/report/ReportCard.tsx`
12. `pages/History.tsx`
13. `App.tsx` — wire all routes

Set environment variable before running:
```bash
echo "VITE_API_URL=https://<your-api-gateway-url>" > .env.local
npm run dev
```

---

## Phase 5 — End-to-End Integration Test

Test each route manually:
- `POST /api/generate` — submit a report form, verify AI output appears
- `GET /api/reports` — navigate to history page, verify past reports load
- `DELETE /api/reports/{id}` — delete a report, verify it disappears

Check Lambda logs in CloudWatch if anything fails:
```bash
aws logs tail /aws/lambda/daily-report-generator --follow
```

---

## Phase 6 — Amplify Deployment

Push frontend to GitHub first:
```bash
git init && git add . && git commit -m "feat: initial daily report generator"
git remote add origin https://github.com/<your-username>/daily-report-generator.git
git push -u origin main
```

Deploy Amplify stack:
```bash
cd infrastructure && cdk deploy ReportsFrontendStack
```

Set `VITE_API_URL` environment variable in the Amplify Console → App Settings → Environment Variables.

Trigger a new build in Amplify Console after setting the env var.

Test the live URL with a full report generation flow.

---

## Phase 7 — Article + Submission

- Write article on AWS Builder Center
- Title format: `Weekend Productivity Challenge: Daily Report Generator`
- Add tag: `#productivity`
- Include GitHub repo link + Amplify live URL
- Submit before July 13, 2026 at 1:00 PM PT

---

## Important Notes

### Bedrock Model Fallback Strategy
If Claude Haiku 4.5 quota is not approved before the deadline, the Lambda defaults to `amazon.nova-lite-v1:0` (Amazon Nova Lite), which is generally available and requires no separate quota request. Both models are accessed through the same Converse API call — no code changes needed, just swap the environment variable in the CDK stack.

### Cost Guard
Lambda is configured with 512 MB memory and 30-second timeout. Bedrock calls are synchronous (no streaming) to keep Lambda execution time low. DynamoDB uses on-demand capacity (pay-per-request) to eliminate idle costs during the challenge period.

### Region
All resources deploy to `us-east-1` where Bedrock model availability is broadest.
