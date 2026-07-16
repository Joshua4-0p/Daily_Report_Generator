# Cloud Infrastructure Build Guide
## Daily Report Generator — AWS CDK (TypeScript) + Node.js 24.x

All infrastructure is built using AWS CDK (TypeScript). Lambda functions use Node.js 24.x runtime with AWS SDK v3. Phases are ordered by dependency — complete each phase fully before moving to the next.

---

## Prerequisites

```bash
node --version          # >= 20.x required
npm install -g aws-cdk  # CDK CLI
aws sts get-caller-identity  # Verify CLI is configured (us-east-1)
cdk bootstrap aws://396531908858/us-east-1  # Only once per account/region
```

---

## CDK Project Initialization

```bash
mkdir infrastructure && cd infrastructure
cdk init app --language typescript
```

Install CDK construct packages:
```bash
npm install @aws-cdk/aws-lambda-nodejs aws-cdk-lib constructs
npm install -D esbuild   # Required by NodejsFunction for bundling
```

Update `cdk.json` to configure the app:
```json
{
  "app": "npx ts-node bin/app.ts",
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:stackRelativeExports": true
  }
}
```

### CDK Entry Point (`bin/app.ts`)

```typescript
import * as cdk from "aws-cdk-lib";
import { ReportsDatabaseStack } from "../lib/stacks/database-stack";
import { ReportsApiStack } from "../lib/stacks/api-stack";
import { ReportsFrontendStack } from "../lib/stacks/frontend-stack";

const app = new cdk.App();

const env = {
  account: "396531908858",
  region: "us-east-1",
};

const dbStack = new ReportsDatabaseStack(app, "ReportsDatabaseStack", { env });

const apiStack = new ReportsApiStack(app, "ReportsApiStack", {
  env,
  reportsTable: dbStack.reportsTable,
});

new ReportsFrontendStack(app, "ReportsFrontendStack", { env });

app.synth();
```

---

## Phase 1 — Database Stack (DynamoDB)

**File:** `lib/stacks/database-stack.ts`
**Deploys first** — no dependencies on other stacks.

```typescript
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export class ReportsDatabaseStack extends cdk.Stack {
  public readonly reportsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.reportsTable = new dynamodb.Table(this, "ReportsTable", {
      tableName: "DailyReports",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey:      { name: "reportId", type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,  // On-demand = no idle costs
      removalPolicy: cdk.RemovalPolicy.RETAIN,             // Keep data if stack is deleted
      pointInTimeRecovery: false,                          // Not needed for MVP
    });

    // GSI: query all reports for a user sorted by date
    this.reportsTable.addGlobalSecondaryIndex({
      indexName: "DateIndex",
      partitionKey: { name: "userId",    type: dynamodb.AttributeType.STRING },
      sortKey:      { name: "date",      type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Stack output: table name used by API stack
    new cdk.CfnOutput(this, "TableName", {
      value: this.reportsTable.tableName,
      exportName: "DailyReports-TableName",
    });

    new cdk.CfnOutput(this, "TableArn", {
      value: this.reportsTable.tableArn,
      exportName: "DailyReports-TableArn",
    });
  }
}
```

**Deploy:**
```bash
cdk deploy ReportsDatabaseStack
```
Note the output `TableName: DailyReports` — already set as the `tableName` property above.

---

## Phase 2 — Lambda Function (Report Generation Logic)

**Directory:** `lambda/`
**Build tool:** esbuild (bundled automatically by `NodejsFunction` CDK construct)
**Runtime:** Node.js 24.x | **SDK:** AWS SDK v3

### Lambda Project Setup

```bash
mkdir -p lambda/src/handlers lambda/src/utils
cd lambda
npm init -y
npm install @aws-sdk/client-bedrock-runtime @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb uuid
npm install -D typescript @types/node @types/uuid
```

`lambda/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

---

### 2a. Prompt Builder (`lambda/src/utils/promptBuilder.ts`)

```typescript
export interface ReportInput {
  employeeName: string;
  date: string;
  tasksCompleted: string;
  tomorrowPlan?: string;
  challenges?: string;
}

export function buildPrompt(input: ReportInput): string {
  const {
    employeeName,
    date,
    tasksCompleted,
    tomorrowPlan,
    challenges,
  } = input;

  const challengeText = challenges && challenges.trim().length > 0
    ? challenges.trim()
    : null;

  const tomorrowText = tomorrowPlan && tomorrowPlan.trim().length > 0
    ? tomorrowPlan.trim()
    : null;

  return `You are a professional workplace assistant that formats daily work reports.

Convert the following raw notes into a clean, structured daily report. Use professional workplace language. Keep each bullet point concise (one line maximum).

Employee: ${employeeName}
Date: ${date}

RAW NOTES:
Tasks done today: ${tasksCompleted}
${tomorrowText ? `Plans for tomorrow: ${tomorrowText}` : "Plans for tomorrow: Not specified"}
${challengeText ? `Challenges encountered: ${challengeText}` : "Challenges encountered: None mentioned"}

Format the output EXACTLY as follows (use these exact section headers in uppercase):

TASKS COMPLETED TODAY:
• [bullet points of tasks done today, converted to professional language]

PLANNED FOR TOMORROW:
• [bullet points of tomorrow's plans, or "To be determined" if none provided]

CHALLENGES & BLOCKERS:
${challengeText ? "• [professional description of the challenge]" : "None reported."}

OVERALL STATUS:
[Single sentence professional status, e.g. "On track — all planned tasks completed." or "Slightly delayed — awaiting dependency resolution."]

Important rules:
- Convert casual language to professional workplace language
- Keep bullet points concise and action-oriented  
- If no challenges were mentioned, write exactly "None reported." under CHALLENGES & BLOCKERS
- Do not add any text before TASKS COMPLETED TODAY or after the OVERALL STATUS line
- Do not use markdown formatting (no bold, no headers with #)`;
}
```

---

### 2b. Bedrock Utility (`lambda/src/utils/bedrock.ts`)

Uses the **Converse API** — works with both Amazon Nova Lite and Claude models with zero code changes.

```typescript
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" });

export async function callBedrock(prompt: string): Promise<string> {
  const modelId = process.env.BEDROCK_MODEL_ID ?? "amazon.nova-lite-v1:0";

  const messages: Message[] = [
    {
      role: "user",
      content: [{ text: prompt }],
    },
  ];

  const command = new ConverseCommand({
    modelId,
    messages,
    inferenceConfig: {
      maxTokens: 1024,
      temperature: 0.3,    // Low temperature = consistent, professional output
      topP: 0.9,
    },
  });

  const response = await client.send(command);

  const outputMessage = response.output?.message;
  if (!outputMessage?.content?.[0]?.text) {
    throw new Error("Bedrock returned an empty response");
  }

  return outputMessage.content[0].text.trim();
}
```

> **Model switching:** To switch from Nova Lite to Claude Haiku 4.5 after quota approval — change `BEDROCK_MODEL_ID` in the CDK API stack and run `cdk deploy ReportsApiStack`. No Lambda code changes needed.

---

### 2c. DynamoDB Utility (`lambda/src/utils/dynamodb.ts`)

```typescript
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const TABLE_NAME = process.env.TABLE_NAME ?? "DailyReports";

export interface SavedReport {
  reportId: string;
  userId: string;
  employeeName: string;
  date: string;
  rawInput: string;
  formattedReport: string;
  createdAt: string;
}

export async function saveReport(data: Omit<SavedReport, "reportId" | "createdAt">): Promise<SavedReport> {
  const reportId = uuidv4();
  const createdAt = new Date().toISOString();
  const item: SavedReport = { ...data, reportId, createdAt };

  await client.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(item),
  }));

  return item;
}

export async function getReportsByUser(userId: string): Promise<SavedReport[]> {
  const result = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "DateIndex",
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: marshall({ ":uid": userId }),
    ScanIndexForward: false,    // Newest first
    Limit: 30,
  }));

  return (result.Items ?? []).map(item => unmarshall(item) as SavedReport);
}

export async function deleteReport(userId: string, reportId: string): Promise<void> {
  await client.send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ userId, reportId }),
  }));
}
```

---

### 2d. Generate Handler (`lambda/src/handlers/generateReport.ts`)

```typescript
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { buildPrompt } from "../utils/promptBuilder";
import { callBedrock } from "../utils/bedrock";

export async function generateReport(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const body = JSON.parse(event.body ?? "{}");
  const { employeeName, date, tasksCompleted, tomorrowPlan, challenges } = body;

  // Basic validation
  if (!employeeName || !date || !tasksCompleted) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Missing required fields: employeeName, date, tasksCompleted" }),
    };
  }

  const prompt = buildPrompt({ employeeName, date, tasksCompleted, tomorrowPlan, challenges });
  const report = await callBedrock(prompt);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, report }),
  };
}
```

---

### 2e. Save Report Handler (`lambda/src/handlers/saveReport.ts`)

```typescript
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { saveReport } from "../utils/dynamodb";

export async function saveReportHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const body = JSON.parse(event.body ?? "{}");
  const { employeeName, date, rawInput, formattedReport } = body;

  if (!employeeName || !date || !rawInput || !formattedReport) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Missing required fields" }),
    };
  }

  const userId = employeeName.toLowerCase().trim().replace(/\s+/g, "_");
  const saved = await saveReport({ userId, employeeName, date, rawInput, formattedReport });

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, report: saved }),
  };
}
```

---

### 2f. Get History Handler (`lambda/src/handlers/getHistory.ts`)

```typescript
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getReportsByUser } from "../utils/dynamodb";

export async function getHistory(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const userId = event.queryStringParameters?.userId;

  if (!userId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Missing userId query parameter" }),
    };
  }

  const normalizedId = userId.toLowerCase().trim().replace(/\s+/g, "_");
  const reports = await getReportsByUser(normalizedId);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, reports }),
  };
}
```

---

### 2g. Delete Handler (`lambda/src/handlers/deleteReport.ts`)

```typescript
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { deleteReport } from "../utils/dynamodb";

export async function deleteReportHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const reportId = event.pathParameters?.reportId;
  const userId = event.queryStringParameters?.userId;

  if (!reportId || !userId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Missing reportId or userId" }),
    };
  }

  const normalizedId = userId.toLowerCase().trim().replace(/\s+/g, "_");
  await deleteReport(normalizedId, reportId);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
}
```

---

### 2h. Lambda Router (`lambda/src/index.ts`)

Single entry point — routes requests based on HTTP method + path.

```typescript
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { generateReport } from "./handlers/generateReport";
import { saveReportHandler } from "./handlers/saveReport";
import { getHistory } from "./handlers/getHistory";
import { deleteReportHandler } from "./handlers/deleteReport";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Content-Type": "application/json",
};

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  // Handle CORS preflight
  if (event.requestContext.http.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  try {
    const routeKey = event.routeKey; // e.g. "POST /api/generate"
    let result: APIGatewayProxyResultV2;

    switch (routeKey) {
      case "POST /api/generate":
        result = await generateReport(event);
        break;
      case "POST /api/reports":
        result = await saveReportHandler(event);
        break;
      case "GET /api/reports":
        result = await getHistory(event);
        break;
      case "DELETE /api/reports/{reportId}":
        result = await deleteReportHandler(event);
        break;
      default:
        result = {
          statusCode: 404,
          body: JSON.stringify({ success: false, error: "Route not found" }),
        };
    }

    // Inject CORS headers into every response
    return {
      ...result,
      headers: { ...(result as any).headers, ...CORS_HEADERS },
    };
  } catch (error) {
    console.error("Lambda error:", error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: "Internal server error" }),
    };
  }
};
```

---

## Phase 3 — API Stack (Lambda + API Gateway + IAM)

**File:** `lib/stacks/api-stack.ts`

> Complete Lambda code (Phase 2) before deploying this stack. The CDK construct bundles the Lambda automatically with esbuild.

```typescript
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayIntegrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as path from "path";

interface ReportsApiStackProps extends cdk.StackProps {
  reportsTable: dynamodb.Table;
}

export class ReportsApiStack extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ReportsApiStackProps) {
    super(scope, id, props);

    const { reportsTable } = props;

    // ── IAM Role for Lambda ──────────────────────────────────────────────────
    const lambdaRole = new iam.Role(this, "ReportsLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"  // CloudWatch logs
        ),
      ],
    });

    // Bedrock: allow Converse API on Nova Lite (and Claude Haiku when quota approved)
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["bedrock:InvokeModel", "bedrock:Converse"],
      resources: [
        `arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0`,
        `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5:0`,
      ],
    }));

    // DynamoDB: least-privilege (specific table + GSI only)
    reportsTable.grantReadWriteData(lambdaRole);

    // ── Lambda Function ───────────────────────────────────────────────────────
    const reportsLambda = new lambdaNodejs.NodejsFunction(this, "ReportsHandler", {
      functionName: "daily-report-generator",
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, "../../lambda/src/index.ts"),
      handler: "handler",
      role: lambdaRole,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      bundling: {
        minify: true,
        sourceMap: false,
        target: "es2022",
        format: lambdaNodejs.OutputFormat.ESM,
        externalModules: [],   // Bundle everything (no Lambda layers needed)
        nodeModules: ["@aws-sdk/client-bedrock-runtime", "@aws-sdk/client-dynamodb", "@aws-sdk/util-dynamodb", "uuid"],
      },
      environment: {
        TABLE_NAME:        reportsTable.tableName,
        BEDROCK_MODEL_ID:  "amazon.nova-lite-v1:0",  // Switch to claude haiku when quota approved
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",     // Reuse HTTP connections = faster
        ALLOWED_ORIGIN:    "*",                        // Update to Amplify URL after deploy
        NODE_OPTIONS: "--enable-source-maps",
      },
      logRetention: logs.RetentionDays.ONE_WEEK,      // Keep logs 7 days only (cost saving)
    });

    // ── API Gateway (HTTP API — cheaper than REST API) ────────────────────────
    const httpApi = new apigateway.HttpApi(this, "ReportsHttpApi", {
      apiName: "daily-report-generator-api",
      corsPreflight: {
        allowOrigins: ["*"],           // Update to Amplify URL after frontend deploy
        allowMethods: [
          apigateway.CorsHttpMethod.GET,
          apigateway.CorsHttpMethod.POST,
          apigateway.CorsHttpMethod.DELETE,
          apigateway.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["Content-Type", "Authorization"],
        maxAge: cdk.Duration.days(1),
      },
    });

    // Lambda integration
    const lambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
      "LambdaIntegration",
      reportsLambda
    );

    // Register all routes
    httpApi.addRoutes({ path: "/api/generate",             methods: [apigateway.HttpMethod.POST],   integration: lambdaIntegration });
    httpApi.addRoutes({ path: "/api/reports",              methods: [apigateway.HttpMethod.POST],   integration: lambdaIntegration });
    httpApi.addRoutes({ path: "/api/reports",              methods: [apigateway.HttpMethod.GET],    integration: lambdaIntegration });
    httpApi.addRoutes({ path: "/api/reports/{reportId}",   methods: [apigateway.HttpMethod.DELETE], integration: lambdaIntegration });

    this.apiUrl = httpApi.apiEndpoint;

    // ── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
      description: "API Gateway endpoint — set this as VITE_API_URL in the frontend",
      exportName: "DailyReports-ApiUrl",
    });

    new cdk.CfnOutput(this, "LambdaFunctionName", {
      value: reportsLambda.functionName,
      exportName: "DailyReports-LambdaName",
    });
  }
}
```

**Deploy:**
```bash
# From infrastructure/ directory
cdk deploy ReportsApiStack
```

Copy the `ApiUrl` output value. Paste it into `frontend/.env.local` as `VITE_API_URL`.

### Frontend Integration After This Phase

Once the API stack is deployed, immediately integrate the frontend:

```bash
# In frontend/.env.local
VITE_API_URL=https://abc123xyz.execute-api.us-east-1.amazonaws.com
```

Test the backend manually with curl before building the frontend UI:

```bash
# Test report generation
curl -X POST https://<your-api-url>/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "employeeName": "Joshua Fotseu",
    "date": "2026-07-11",
    "tasksCompleted": "Fixed login bug, wrote unit tests, reviewed PR from team",
    "tomorrowPlan": "Work on report module",
    "challenges": ""
  }'

# Expected: { "success": true, "report": "TASKS COMPLETED TODAY:\n• ..." }
```

---

# Cloud Infrastructure — Phase 3.5: Auth, Storage & User Profile Stack
## Daily Report Generator — Addition to daily_report_generator_cloud_infrastructure.md

> Insert this phase between Phase 3 (API Stack) and Phase 4 (Frontend Build).
> Phases 1–3 are already deployed. This phase adds: Cognito authentication,
> S3 logo storage, UserProfiles DynamoDB table, new Lambda handlers,
> JWT authorizer on API Gateway, and updates the active Bedrock model.

---

## IMMEDIATE ACTION — Switch Bedrock Model to Approved Claude Haiku 4.5

Quota for `anthropic.claude-haiku-4-5-20251001-v1:0` is now approved.
Update the Lambda environment variable immediately:

```bash
aws lambda update-function-configuration \
  --function-name daily-report-generator \
  --region us-east-1 \
  --environment "Variables={
    TABLE_NAME=DailyReports,
    BEDROCK_MODEL_ID=anthropic.claude-haiku-4-5-20251001-v1:0,
    AWS_NODEJS_CONNECTION_REUSE_ENABLED=1,
    ALLOWED_ORIGIN=*,
    NODE_OPTIONS=--enable-source-maps
  }"
```

Verify the update:
```bash
aws lambda get-function-configuration \
  --function-name daily-report-generator \
  --region us-east-1 \
  --query "Environment.Variables.BEDROCK_MODEL_ID"
# Expected: "anthropic.claude-haiku-4-5-20251001-v1:0"
```

Test with a quick curl to confirm the upgraded model responds correctly:
```bash
curl -X POST https://<your-api-url>/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "employeeName": "Joshua Fotseu",
    "date": "2026-07-14",
    "tasksCompleted": "Completed Phase 3 cloud infrastructure and switched to Claude Haiku 4.5",
    "challenges": ""
  }'
```

---

## Phase 3.5 — Auth, Storage & User Profile Stack

**New CDK Stacks:**
- `ReportsAuthStack` — Amazon Cognito User Pool + App Client
- `ReportsStorageStack` — Amazon S3 bucket for company logos

**Updated CDK Stacks:**
- `ReportsDatabaseStack` — add `UserProfiles` DynamoDB table
- `ReportsApiStack` — add JWT authorizer, new Lambda routes, new env vars, S3 bucket ARN permission

**Deployment order for Phase 3.5:**
```
ReportsAuthStack → ReportsStorageStack → ReportsDatabaseStack (update) → ReportsApiStack (update)
```

---

### 3.5a — Install New CDK Packages

Inside `infrastructure/`:
```bash
npm install @aws-cdk/aws-cognito @aws-cdk/aws-s3
```

These are stable in `aws-cdk-lib` — verify:
```bash
node -e "require('aws-cdk-lib/aws-cognito'); require('aws-cdk-lib/aws-s3'); console.log('OK')"
```

---

### 3.5b — Auth Stack (`lib/stacks/auth-stack.ts`)

```typescript
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

export class ReportsAuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // ADR: Cognito User Pool chosen over custom auth — managed service, handles
    // password hashing, JWT issuance, email verification, and token refresh.
    // Free for <50K MAU. Satisfies NFR-04 (security) with zero custom auth code.
    this.userPool = new cognito.UserPool(this, "ReportsUserPool", {
      userPoolName: "daily-report-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: true, mutable: true },
        phoneNumber: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      email: cognito.UserPoolEmail.withCognito(), // SES not required for MVP
    });

    this.userPoolClient = this.userPool.addClient("ReportsWebClient", {
      userPoolClientName: "daily-report-web",
      authFlows: {
        userPassword: true,       // Email + password login
        userSrp: true,            // Secure Remote Password (recommended)
      },
      generateSecret: false,      // Must be false for browser-based clients
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true, // Security: don't reveal if email exists
    });

    // Stack outputs — needed by frontend Amplify config and API stack JWT authorizer
    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      exportName: "DailyReports-UserPoolId",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      exportName: "DailyReports-UserPoolClientId",
    });

    new cdk.CfnOutput(this, "UserPoolArn", {
      value: this.userPool.userPoolArn,
      exportName: "DailyReports-UserPoolArn",
    });
  }
}
```

Deploy:
```bash
cdk deploy ReportsAuthStack
```

Note the outputs: `UserPoolId`, `UserPoolClientId`, `UserPoolArn` — all three are needed in the next steps.

---

### 3.5c — Storage Stack (`lib/stacks/storage-stack.ts`)

```typescript
import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class ReportsStorageStack extends cdk.Stack {
  public readonly logosBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // ADR: S3 pre-signed URL pattern — browser uploads directly to S3,
    // Lambda only generates a short-lived signed URL. This avoids routing
    // large logo files through Lambda (memory cost, timeout risk) and keeps
    // the Lambda payload small. Satisfies NFR-02 (cost) and NFR-04 (security).
    this.logosBucket = new s3.Bucket(this, "LogosBucket", {
      bucketName: `daily-report-logos-${this.account}`, // Account-scoped name avoids global collision
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ["*"],              // Will be restricted to Amplify URL in Phase 5
          allowedHeaders: ["*"],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        {
          // Clean up any incomplete multipart uploads after 7 days
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    new cdk.CfnOutput(this, "LogosBucketName", {
      value: this.logosBucket.bucketName,
      exportName: "DailyReports-LogosBucketName",
    });

    new cdk.CfnOutput(this, "LogosBucketArn", {
      value: this.logosBucket.bucketArn,
      exportName: "DailyReports-LogosBucketArn",
    });
  }
}
```

Deploy:
```bash
cdk deploy ReportsStorageStack
```

---

### 3.5d — Update Database Stack (Add UserProfiles Table)

Add the `UserProfiles` table to `lib/stacks/database-stack.ts`. Add it below the existing `DailyReports` table:

```typescript
// ── UserProfiles Table ─────────────────────────────────────────────────────
// Stores extended profile data that Cognito does not natively support:
// company name, department, S3 logo URL. PK is the Cognito sub (userId).
public readonly userProfilesTable: dynamodb.Table;

// Inside constructor, after the DailyReports table block:
this.userProfilesTable = new dynamodb.Table(this, "UserProfilesTable", {
  tableName: "UserProfiles",
  partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

new cdk.CfnOutput(this, "UserProfilesTableName", {
  value: this.userProfilesTable.tableName,
  exportName: "DailyReports-UserProfilesTableName",
});

new cdk.CfnOutput(this, "UserProfilesTableArn", {
  value: this.userProfilesTable.tableArn,
  exportName: "DailyReports-UserProfilesTableArn",
});
```

UserProfiles table item schema:
```typescript
interface UserProfile {
  userId: string;         // Cognito sub (UUID) — partition key
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  department: string;
  logoKey: string;        // S3 object key, e.g. "logos/<userId>/logo.png"
  defaultTemplate: "classic" | "professional" | "modern" | "corporate";
  createdAt: string;      // ISO timestamp
  updatedAt: string;      // ISO timestamp
}
```

Redeploy the database stack to add the new table:
```bash
cdk deploy ReportsDatabaseStack
```

---

### 3.5e — New Lambda Handlers for Auth Phase

Add these files inside `infrastructure/lambda/src/handlers/`:

**`getUploadUrl.ts`** — generates S3 pre-signed PUT URL for logo upload:
```typescript
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const BUCKET = process.env.LOGOS_BUCKET_NAME ?? "";

export async function getUploadUrl(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  // userId comes from JWT authorizer context — already validated by API Gateway
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string;
  const body = JSON.parse(event.body ?? "{}");
  const { fileType } = body; // e.g. "image/png"

  if (!fileType || !["image/png", "image/jpeg", "image/svg+xml"].includes(fileType)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Invalid file type. Use PNG, JPG, or SVG." }),
    };
  }

  const key = `logos/${userId}/logo.${fileType.split("/")[1]}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: fileType,
    ContentLength: undefined, // enforced by bucket policy
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5-minute expiry

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, uploadUrl: signedUrl, key }),
  };
}
```

Install the S3 presigner inside `infrastructure/lambda/`:
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

**`saveProfile.ts`** — creates or updates the user profile in UserProfiles table:
```typescript
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const TABLE = process.env.USER_PROFILES_TABLE ?? "UserProfiles";

export async function saveProfile(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string;
  const body = JSON.parse(event.body ?? "{}");
  const { fullName, email, phone, companyName, department, logoKey, defaultTemplate } = body;

  if (!fullName || !email || !phone || !companyName || !department || !logoKey) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Missing required profile fields" }),
    };
  }

  const now = new Date().toISOString();
  const profile = {
    userId,
    fullName,
    email,
    phone,
    companyName,
    department,
    logoKey,
    defaultTemplate: defaultTemplate ?? "classic",
    createdAt: now,
    updatedAt: now,
  };

  await client.send(new PutItemCommand({
    TableName: TABLE,
    Item: marshall(profile),
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, profile }),
  };
}
```

**`getProfile.ts`** — retrieves the user profile:
```typescript
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const TABLE = process.env.USER_PROFILES_TABLE ?? "UserProfiles";
const BUCKET = process.env.LOGOS_BUCKET_NAME ?? "";

export async function getProfile(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string;

  const result = await dynamo.send(new GetItemCommand({
    TableName: TABLE,
    Key: marshall({ userId }),
  }));

  if (!result.Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ success: false, error: "Profile not found" }),
    };
  }

  const profile = unmarshall(result.Item);

  // Generate a fresh pre-signed GET URL for the logo (1-hour expiry)
  let logoUrl: string | null = null;
  if (profile.logoKey) {
    const getCommand = new GetObjectCommand({ Bucket: BUCKET, Key: profile.logoKey });
    logoUrl = await getSignedUrl(s3, getCommand, { expiresIn: 3600 });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, profile: { ...profile, logoUrl } }),
  };
}
```

---

### 3.5f — Update Lambda Router (`lambda/src/index.ts`)

Add the three new routes to the switch block in `index.ts`:

```typescript
// Add these cases to the existing switch(routeKey):
case "POST /api/profile":
  result = await saveProfile(event);
  break;
case "GET /api/profile":
  result = await getProfile(event);
  break;
case "POST /api/upload-url":
  result = await getUploadUrl(event);
  break;
```

Add the new imports at the top of `index.ts`:
```typescript
import { saveProfile } from "./handlers/saveProfile";
import { getProfile } from "./handlers/getProfile";
import { getUploadUrl } from "./handlers/getUploadUrl";
```

---

### 3.5g — Update API Stack (`lib/stacks/api-stack.ts`)

The API stack needs four updates: JWT authorizer, new env vars, new S3 permissions, and new routes.

**Update the `ReportsApiStackProps` interface:**
```typescript
interface ReportsApiStackProps extends cdk.StackProps {
  reportsTable: dynamodb.Table;
  userProfilesTable: dynamodb.Table;    // NEW
  userPool: cognito.UserPool;           // NEW
  logosBucket: s3.Bucket;              // NEW
}
```

Add new imports at the top:
```typescript
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as apigatewayAuthorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
// If alpha package needed: import * as apigatewayAuthorizers from "@aws-cdk/aws-apigatewayv2-authorizers-alpha";
```

**Add JWT authorizer (inside the constructor, after httpApi is created):**
```typescript
// JWT Authorizer — Cognito validates token before Lambda is invoked
// Satisfies NFR-04: Lambda never receives unauthenticated requests on protected routes
const jwtAuthorizer = new apigatewayAuthorizers.HttpJwtAuthorizer(
  "CognitoAuthorizer",
  `https://cognito-idp.us-east-1.amazonaws.com/${props.userPool.userPoolId}`,
  {
    jwtAudience: [userPoolClient.userPoolClientId],
    // NOTE: userPoolClient must be accessible here — either pass it via props
    // or reference it as a stack output from ReportsAuthStack
  }
);
```

**Add new environment variables to the Lambda NodejsFunction:**
```typescript
environment: {
  TABLE_NAME: reportsTable.tableName,
  USER_PROFILES_TABLE: props.userProfilesTable.tableName,   // NEW
  LOGOS_BUCKET_NAME: props.logosBucket.bucketName,           // NEW
  BEDROCK_MODEL_ID: "anthropic.claude-haiku-4-5-20251001-v1:0",  // UPDATED
  AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
  ALLOWED_ORIGIN: "*",
  NODE_OPTIONS: "--enable-source-maps",
},
```

**Add new IAM permissions to the Lambda role:**
```typescript
// UserProfiles table permissions
props.userProfilesTable.grantReadWriteData(lambdaRole);

// S3 logo bucket permissions (pre-signed URL generation requires s3:PutObject + s3:GetObject)
props.logosBucket.grantReadWrite(lambdaRole);
```

**Add new routes with JWT authorizer:**
```typescript
// Protected routes — require valid Cognito JWT
httpApi.addRoutes({
  path: "/api/profile",
  methods: [apigateway.HttpMethod.GET],
  integration: lambdaIntegration,
  authorizer: jwtAuthorizer,
});
httpApi.addRoutes({
  path: "/api/profile",
  methods: [apigateway.HttpMethod.POST],
  integration: lambdaIntegration,
  authorizer: jwtAuthorizer,
});
httpApi.addRoutes({
  path: "/api/upload-url",
  methods: [apigateway.HttpMethod.POST],
  integration: lambdaIntegration,
  authorizer: jwtAuthorizer,
});

// Also add authorizer to existing report routes
// Update the existing addRoutes calls to include: authorizer: jwtAuthorizer
httpApi.addRoutes({ path: "/api/generate",           methods: [apigateway.HttpMethod.POST],   integration: lambdaIntegration, authorizer: jwtAuthorizer });
httpApi.addRoutes({ path: "/api/reports",            methods: [apigateway.HttpMethod.POST],   integration: lambdaIntegration, authorizer: jwtAuthorizer });
httpApi.addRoutes({ path: "/api/reports",            methods: [apigateway.HttpMethod.GET],    integration: lambdaIntegration, authorizer: jwtAuthorizer });
httpApi.addRoutes({ path: "/api/reports/{reportId}", methods: [apigateway.HttpMethod.DELETE], integration: lambdaIntegration, authorizer: jwtAuthorizer });
```

**Update `bin/app.ts` to pass new props:**
```typescript
const authStack = new ReportsAuthStack(app, "ReportsAuthStack", { env });
const storageStack = new ReportsStorageStack(app, "ReportsStorageStack", { env });

const dbStack = new ReportsDatabaseStack(app, "ReportsDatabaseStack", { env });

const apiStack = new ReportsApiStack(app, "ReportsApiStack", {
  env,
  reportsTable: dbStack.reportsTable,
  userProfilesTable: dbStack.userProfilesTable,   // NEW
  userPool: authStack.userPool,                    // NEW
  logosBucket: storageStack.logosBucket,           // NEW
});
```

Deploy the updated stacks:
```bash
cdk deploy ReportsDatabaseStack   # Adds UserProfiles table
cdk deploy ReportsApiStack        # Adds JWT authorizer, new routes, new env vars
```

---

### 3.5h — New Stack Outputs for Frontend

After deploying, collect these values for the frontend `.env.local`:

```bash
# Get all outputs
aws cloudformation describe-stacks \
  --stack-name ReportsAuthStack \
  --region us-east-1 \
  --query "Stacks[0].Outputs"

aws cloudformation describe-stacks \
  --stack-name ReportsStorageStack \
  --region us-east-1 \
  --query "Stacks[0].Outputs"
```

Update `frontend/.env.local` with all required values:
```
VITE_API_URL=https://<id>.execute-api.us-east-1.amazonaws.com
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_LOGOS_BUCKET=daily-report-logos-396531908858
VITE_AWS_REGION=us-east-1
```

Update `frontend/.env.example` with the same keys but placeholder values.

---

### 3.5i — Curl Test Plan (Phase 3.5 Verification)

Before moving to the frontend, test the new auth-protected routes.

First, get a test JWT token via Cognito (after creating a test user):
```bash
# Create a test user in Cognito
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username test@example.com \
  --temporary-password Test@1234 \
  --message-action SUPPRESS \
  --region us-east-1

# Authenticate to get tokens
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <UserPoolClientId> \
  --auth-parameters USERNAME=test@example.com,PASSWORD=Test@1234 \
  --region us-east-1
```

Use the `IdToken` from the response in all subsequent tests:
```bash
TOKEN="<IdToken from above>"

# Test 1: GET /api/profile — expect 404 (profile not created yet)
curl -H "Authorization: Bearer $TOKEN" \
  "https://<api-url>/api/profile"

# Test 2: POST /api/upload-url — get presigned URL
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileType":"image/png"}' \
  "https://<api-url>/api/upload-url"

# Test 3: POST /api/profile — save profile
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Joshua Fotseu",
    "email": "test@example.com",
    "phone": "+237XXXXXXXXX",
    "companyName": "Digisol Group",
    "department": "Engineering",
    "logoKey": "logos/<userId>/logo.png",
    "defaultTemplate": "professional"
  }' \
  "https://<api-url>/api/profile"

# Test 4: GET /api/profile — should return full profile with logoUrl
curl -H "Authorization: Bearer $TOKEN" \
  "https://<api-url>/api/profile"

# Test 5: POST /api/generate with auth — full authenticated report generation
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeName": "Joshua Fotseu",
    "date": "2026-07-14",
    "tasksCompleted": "Completed Phase 3.5 auth infrastructure with Cognito and S3",
    "tomorrowPlan": "Start building the React frontend",
    "challenges": "JWT authorizer CORS configuration required extra debugging"
  }' \
  "https://<api-url>/api/generate"

# Test 6: Unauthenticated request — must return 401
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"tasksCompleted": "test"}' \
  "https://<api-url>/api/generate"
# Expected: 401 Unauthorized (blocked by API Gateway JWT authorizer — Lambda not invoked)
```

All 6 tests must pass before proceeding to Phase 4 (Frontend).

---

## Phase 3.5 — Completion Status Template

```
PHASE 3.5 STATUS
  Bedrock model updated: anthropic.claude-haiku-4-5-20251001-v1:0  CONFIRMED
  ReportsAuthStack: DEPLOYED
    Cognito User Pool ID: us-east-1_XXXXXXXXX
    Cognito Client ID: XXXXXXXXXXXXXXXXXXXXXXXXXX
  ReportsStorageStack: DEPLOYED
    Logos Bucket: daily-report-logos-396531908858
  ReportsDatabaseStack (update): DEPLOYED
    UserProfiles table: CONFIRMED
  ReportsApiStack (update): DEPLOYED
    JWT authorizer: ACTIVE on all /api/* routes
    New routes: GET /api/profile, POST /api/profile, POST /api/upload-url

CURL TEST RESULTS (Phase 3.5)
  Test 1 (GET profile - 404):        PASS / FAIL
  Test 2 (upload-url):               PASS / FAIL
  Test 3 (save profile):             PASS / FAIL
  Test 4 (GET profile - found):      PASS / FAIL
  Test 5 (authenticated generate):   PASS / FAIL
  Test 6 (unauthenticated - 401):    PASS / FAIL

FRONTEND ENV VARS
  frontend/.env.local: UPDATED with Cognito + S3 values

READY FOR: Phase 4 — Frontend build (daily_report_generator_frontend_v2.md)
```

## Phase 4 — Frontend Build + Local Integration Test

Build the frontend (see `daily_report_generator_frontend.md` for full details).

Run locally with the deployed API:
```bash
cd frontend && npm run dev
```

Test full flow:
1. Open http://localhost:5173
2. Navigate to /generator
3. Fill in the form and click Generate Report
4. Verify the formatted report appears
5. Click Save to history
6. Navigate to /history and verify the report appears
7. Delete the report and verify it disappears

---

## Phase 5 — Frontend Stack (Amplify Hosting)

**File:** `lib/stacks/frontend-stack.ts`

> Only needed if deploying Amplify via CDK. Amplify can also be set up manually via the Console by connecting to GitHub — both approaches work. The CDK approach is described here for completeness.

```typescript
import * as cdk from "aws-cdk-lib";
import * as amplify from "@aws-cdk/aws-amplify-alpha";
import { Construct } from "constructs";

export class ReportsFrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const amplifyApp = new amplify.App(this, "DailyReportApp", {
      appName: "daily-report-generator",
      sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
        owner: "<your-github-username>",
        repository: "daily-report-generator",
        oauthToken: cdk.SecretValue.secretsManager("github-token"),
      }),
      buildSpec: cdk.aws_codebuild.BuildSpec.fromObjectToYaml({
        version: "1.0",
        frontend: {
          phases: {
            preBuild:  { commands: ["cd frontend && npm ci"] },
            build:     { commands: ["npm run build"] },
          },
          artifacts: {
            baseDirectory: "frontend/dist",
            files: ["**/*"],
          },
          cache: { paths: ["frontend/node_modules/**/*"] },
        },
      }),
      environmentVariables: {
        VITE_API_URL: "<paste-api-gateway-url-here>",
      },
    });

    amplifyApp.addBranch("main", { stage: amplify.BranchType.PRODUCTION });

    new cdk.CfnOutput(this, "AmplifyAppUrl", {
      value: `https://main.${amplifyApp.defaultDomain}`,
    });
  }
}
```

Install the alpha Amplify construct:
```bash
npm install @aws-cdk/aws-amplify-alpha
```

**Alternative (simpler for the challenge):** Set up Amplify manually in the Console:
1. AWS Console → Amplify → New app → Host web app
2. Connect GitHub → Select `daily-report-generator` repo → `main` branch
3. Build settings: auto-detected (Amplify detects Vite)
4. Environment variables: Add `VITE_API_URL = <your api url>`
5. Click Deploy

**Deploy CDK stack if using CDK approach:**
```bash
cdk deploy ReportsFrontendStack
```

### Final CORS Update After Amplify URL is Known

After Amplify deploys and you have the live URL (e.g., `https://main.d1abc123xyz.amplifyapp.com`), update the Lambda CORS environment variable:

```bash
# Update Lambda environment variable via CLI
aws lambda update-function-configuration \
  --function-name daily-report-generator \
  --environment "Variables={TABLE_NAME=DailyReports,BEDROCK_MODEL_ID=amazon.nova-lite-v1:0,ALLOWED_ORIGIN=https://main.d1abc123xyz.amplifyapp.com}"
```

Or update in the CDK stack (`ALLOWED_ORIGIN` env var) and redeploy:
```bash
cdk deploy ReportsApiStack
```

---

## Phase 6 — Switch Bedrock Model (When Quota Approved)

When AWS approves the Claude Haiku 4.5 quota, switching models requires only one command:

```bash
aws lambda update-function-configuration \
  --function-name daily-report-generator \
  --environment "Variables={TABLE_NAME=DailyReports,BEDROCK_MODEL_ID=anthropic.claude-haiku-4-5:0,ALLOWED_ORIGIN=https://main.d1abc123xyz.amplifyapp.com}"
```

No Lambda code changes, no redeployment of the full stack. The Converse API handles the model difference transparently.

---

## Full Deployment Order Summary

```bash
# 1. Bootstrap (once per account/region — already done)
cdk bootstrap aws://396531908858/us-east-1

# 2. Database stack
cdk deploy ReportsDatabaseStack

# 3. API stack (Lambda + API Gateway)
cdk deploy ReportsApiStack
# → Copy ApiUrl output → paste into frontend/.env.local as VITE_API_URL

# 4. Test backend manually (curl)
curl -X POST <ApiUrl>/api/generate ...

# 5. Build + test frontend locally
cd frontend && npm run dev

# 6. Push to GitHub
git add . && git commit -m "feat: daily report generator" && git push

# 7. Amplify (connect repo via Console or CDK)
cdk deploy ReportsFrontendStack  # OR manual Console setup

# 8. Update CORS to Amplify URL
aws lambda update-function-configuration --function-name daily-report-generator ...

# 9. End-to-end test on live Amplify URL

# 10. Write article and submit to AWS Builder Center
```

---

## Monitoring & Debugging

### View Lambda logs in real time
```bash
aws logs tail /aws/lambda/daily-report-generator --follow --region us-east-1
```

### Check Bedrock model availability for your account
```bash
aws bedrock list-foundation-models --region us-east-1 \
  --query "modelSummaries[?contains(modelId,'nova-lite') || contains(modelId,'claude-haiku')].[modelId,modelLifecycle.status]" \
  --output table
```

### Check DynamoDB table contents
```bash
aws dynamodb scan --table-name DailyReports --region us-east-1
```

### Check all stack statuses
```bash
cdk list
aws cloudformation describe-stacks --query "Stacks[?contains(StackName,'Reports')].[StackName,StackStatus]" --output table
```

### Tear down all resources (if needed)
```bash
cdk destroy --all
# Note: DynamoDB table has RETAIN policy — delete manually if needed
aws dynamodb delete-table --table-name DailyReports --region us-east-1
```
