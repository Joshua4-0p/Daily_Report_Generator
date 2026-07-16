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

    // ADR: Lambda role follows least-privilege (NFR-04). Only specific Bedrock model ARNs
    // and the specific DynamoDB table ARN are granted — not wildcards. Both Bedrock model
    // ARNs included so BEDROCK_MODEL_ID env var can switch models without IAM redeployment.
    const lambdaRole = new iam.Role(this, "ReportsLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel", "bedrock:Converse"],
        resources: [
          "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0",
          // Claude Haiku 4.5 requires cross-region inference (no on-demand foundation-model
          // ARN invocation) — grant the inference-profile ARN plus the underlying
          // foundation-model ARNs in the 3 regions the "us." profile can route to.
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        ],
      })
    );

    reportsTable.grantReadWriteData(lambdaRole);

    // ── Lambda Function ──────────────────────────────────────────────────
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
        // Bundle everything into one self-contained file — no separate npm-install
        // step in the staged asset, no dependency on lambda/'s own lockfile at deploy time.
        externalModules: [],
        // AWS SDK v3's dependency chain does a dynamic `require("node:stream")` at runtime;
        // ESM has no native `require`, so esbuild's ESM output needs this shim or the
        // handler crashes at cold start with "Dynamic require of node:stream is not supported".
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      environment: {
        TABLE_NAME: reportsTable.tableName,
        BEDROCK_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
        ALLOWED_ORIGIN: "*",
        NODE_OPTIONS: "--enable-source-maps",
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // ── API Gateway (HTTP API — cheaper than REST API, NFR-02) ──────────
    const httpApi = new apigateway.HttpApi(this, "ReportsHttpApi", {
      apiName: "daily-report-generator-api",
      corsPreflight: {
        allowOrigins: ["*"],
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

    const lambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
      "LambdaIntegration",
      reportsLambda
    );

    httpApi.addRoutes({
      path: "/api/generate",
      methods: [apigateway.HttpMethod.POST],
      integration: lambdaIntegration,
    });
    httpApi.addRoutes({
      path: "/api/reports",
      methods: [apigateway.HttpMethod.POST],
      integration: lambdaIntegration,
    });
    httpApi.addRoutes({
      path: "/api/reports",
      methods: [apigateway.HttpMethod.GET],
      integration: lambdaIntegration,
    });
    httpApi.addRoutes({
      path: "/api/reports/{reportId}",
      methods: [apigateway.HttpMethod.DELETE],
      integration: lambdaIntegration,
    });

    this.apiUrl = httpApi.apiEndpoint;

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
