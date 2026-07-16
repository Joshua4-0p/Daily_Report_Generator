# Cloud Architecture Diagram Description
## Daily Report Generator

This document describes the cloud architecture in sufficient detail to produce an architecture diagram (using draw.io, Lucidchart, Mermaid, or any diagramming tool). Use this as the source of truth when creating the diagram for your AWS Builder Center article.

---

## Architecture Style

**Serverless, event-driven, single-region (us-east-1)**

There are no EC2 instances, no containers, no VPCs required. All compute is managed Lambda. All storage is managed DynamoDB. All frontend delivery is managed Amplify CDN. The architecture follows a simple 3-layer pattern: **Presentation → API → Data**.

---

## Diagram Layout (Top to Bottom)

Arrange the diagram in three horizontal swim lanes / tiers:

```
┌─────────────────────────────────────────────────────────────────┐
│  USER / BROWSER TIER                                            │
│  [User Browser] ──► [AWS Amplify (React App + CDN)]            │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTPS requests
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  API TIER                                                        │
│  [Amazon API Gateway — HTTP API]                                │
│       │                                                         │
│       ▼                                                         │
│  [AWS Lambda — Node.js 24.x]                                    │
└─────────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
┌──────────────────────┐   ┌──────────────────────────────────┐
│  AI SERVICE TIER     │   │  DATA TIER                       │
│  [Amazon Bedrock]    │   │  [Amazon DynamoDB]               │
│  Nova Lite model     │   │  Reports table                   │
│  (Converse API)      │   │  (on-demand capacity)            │
└──────────────────────┘   └──────────────────────────────────┘
```

---

## Component Details

### 1. User Browser
- The end user accesses the app via a web browser
- Makes HTTPS requests to the Amplify-hosted React app
- After the page loads, JavaScript makes API calls directly to API Gateway

### 2. AWS Amplify (Frontend Hosting)
**Icon:** AWS Amplify logo
**Position:** Top tier, far left

- Hosts the compiled React + Vite static build (HTML, JS, CSS, assets)
- Delivers content via AWS CloudFront CDN (built into Amplify automatically)
- Connected to the GitHub repository — every push to `main` triggers an automatic build and deploy
- Environment variable `VITE_API_URL` is configured in Amplify Console pointing to the API Gateway base URL
- **No arrow needed back to user** — the CDN push model delivers the app; subsequent API calls go directly to API Gateway

### 3. Amazon API Gateway (HTTP API)
**Icon:** Amazon API Gateway logo
**Position:** Middle tier, center

- Receives all HTTP requests from the browser (not from Amplify — Amplify only delivers static files)
- Single HTTP API with three routes:
  - `POST /api/generate` — generate a new report
  - `GET /api/reports` — fetch report history
  - `DELETE /api/reports/{reportId}` — delete a specific report
- CORS configuration allows requests only from the Amplify app domain
- Routes all requests to a single Lambda function integration (AWS_PROXY integration type)
- **Arrow from:** Browser (HTTPS)
- **Arrow to:** Lambda

### 4. AWS Lambda (Node.js 24.x)
**Icon:** AWS Lambda logo
**Position:** Middle tier, center (below API Gateway)

- Single Lambda function that acts as a lightweight router
- Reads `event.routeKey` (e.g., `"POST /api/generate"`) to dispatch to the correct handler
- Configuration:
  - Runtime: `nodejs24.x`
  - Memory: 512 MB
  - Timeout: 30 seconds
  - Environment variables: `TABLE_NAME`, `BEDROCK_MODEL_ID`, `AWS_REGION`
- IAM role grants:
  - `bedrock:InvokeModel` on the specific model ARN
  - `dynamodb:PutItem`, `dynamodb:Query`, `dynamodb:DeleteItem` on the specific table ARN
- **Arrow from:** API Gateway
- **Arrow to:** Amazon Bedrock (for generate route)
- **Arrow to:** DynamoDB (for all three routes)

### 5. Amazon Bedrock (Converse API)
**Icon:** Amazon Bedrock logo
**Position:** Bottom tier, left side

- Provides the AI text generation capability
- Accessed by Lambda using the **Converse API** (`ConverseCommand` from `@aws-sdk/client-bedrock-runtime`)
- The Converse API provides a unified interface — same Lambda code works for both:
  - `amazon.nova-lite-v1:0` (Amazon Nova Lite — default, generally available)
  - `anthropic.claude-haiku-4-5:0` (upgrade option when quota is approved)
- Lambda sends a structured prompt containing the user's raw notes and receives the formatted report text
- Bedrock is not a persistent service — Lambda calls it on-demand per report generation request only
- **Arrow from:** Lambda (synchronous invocation)
- **Arrow back to Lambda:** formatted report text response

### 6. Amazon DynamoDB
**Icon:** Amazon DynamoDB logo
**Position:** Bottom tier, right side

- Stores generated reports after the user clicks "Save to History"
- **Table name:** `DailyReports`
- **Partition key:** `userId` (String) — the employee name (lowercased, trimmed)
- **Sort key:** `reportId` (String) — UUID generated at report creation time
- **Attributes stored per item:**
  - `userId` — employee name (partition key)
  - `reportId` — UUID (sort key)
  - `employeeName` — display name (original casing)
  - `date` — ISO date string (YYYY-MM-DD)
  - `rawInput` — the original plain-text notes the user typed
  - `formattedReport` — the AI-generated formatted report text
  - `createdAt` — ISO timestamp of when the report was saved
- **GSI (Global Secondary Index):**
  - Index name: `DateIndex`
  - Partition key: `userId`
  - Sort key: `date`
  - Purpose: enables querying "all reports for this user, sorted by date descending"
- **Capacity:** On-demand (pay-per-request)
- **Arrow from:** Lambda (PutItem for save, Query for history, DeleteItem for delete)

---

## Data Flow — Report Generation (Happy Path)

```
1. User fills form in browser (name, date, tasks, tomorrow plan, challenges)
2. Browser sends POST /api/generate to API Gateway with JSON body
3. API Gateway forwards request to Lambda (AWS_PROXY integration)
4. Lambda parses the request body
5. Lambda calls promptBuilder.ts to construct a structured AI prompt
6. Lambda sends ConverseCommand to Amazon Bedrock with the prompt
7. Bedrock (Nova Lite or Claude Haiku 4.5) processes the prompt
8. Bedrock returns the formatted report text to Lambda
9. Lambda returns 200 response with the formatted report to API Gateway
10. API Gateway returns the response to the browser
11. React app displays the formatted report in the output section
12. User clicks "Save to History" — browser sends separate POST to save
13. Lambda writes the report to DynamoDB
14. Browser shows success toast and the report appears in history
```

---

## Data Flow — History Fetch

```
1. User navigates to /history page
2. Browser sends GET /api/reports?userId=<name> to API Gateway
3. API Gateway forwards to Lambda
4. Lambda queries DynamoDB GSI (DateIndex) for all reports by this userId
5. Lambda returns sorted list of reports (up to 30)
6. Browser renders the report list in the History page table
```

---

## Security Architecture

```
Browser
  │
  │  HTTPS only (Amplify enforces SSL)
  ▼
API Gateway
  │
  │  IAM: Lambda execution role (no public IAM exposure)
  │  CORS: restricted to Amplify domain
  ▼
Lambda (execution role)
  │
  ├──► Bedrock: least-privilege policy (specific model ARN only)
  │
  └──► DynamoDB: least-privilege policy (specific table ARN only)
```

- No credentials flow from frontend to backend — all AWS calls are made by Lambda using its attached IAM role
- Frontend only holds the API Gateway URL (not sensitive)
- No VPC is needed — all services communicate via AWS service endpoints

---

## CDK Stack Organization

The infrastructure is organized into three CDK stacks, each deployed independently:

| Stack Name | Resources Created | Deploy Order |
|---|---|---|
| `ReportsDatabaseStack` | DynamoDB table + GSI | First |
| `ReportsApiStack` | Lambda function + IAM role + API Gateway HTTP API + CloudWatch log group | Second (depends on DatabaseStack for table name) |
| `ReportsFrontendStack` | Amplify app + GitHub connection + branch configuration | Third (optional via CDK — Amplify can also be set up via console) |

Stack outputs (exported values used between stacks):
- `ReportsDatabaseStack` exports: `TableName`, `TableArn`
- `ReportsApiStack` exports: `ApiUrl` (to be set as `VITE_API_URL` in frontend)

---

## Diagram Notes for Article

When drawing this diagram for the article:

1. Use the official AWS architecture icons (available at https://aws.amazon.com/architecture/icons/)
2. Group Bedrock and DynamoDB in a "AWS Managed Services" boundary box
3. Draw a dashed boundary around the Lambda + API Gateway as "Serverless Backend"
4. Add a note on the Bedrock box: "Model: Nova Lite (default) / Claude Haiku 4.5 (upgrade)"
5. Add cost annotations if desired: "~$0.38/month at 100 reports/day"
6. The Amplify → Browser arrow should be labeled "Static assets (CDN)"
7. The Browser → API Gateway arrow should be labeled "HTTPS API calls"
8. The Lambda → Bedrock arrow should be labeled "Converse API (synchronous)" 
