#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ReportsAuthStack } from "../lib/stacks/auth-stack";
import { ReportsStorageStack } from "../lib/stacks/storage-stack";
import { ReportsDatabaseStack } from "../lib/stacks/database-stack";
import { ReportsApiStack } from "../lib/stacks/api-stack";
import { ReportsFrontendStack } from "../lib/stacks/frontend-stack";

const app = new cdk.App();

const env = {
  account: "396531908858",
  region: "us-east-1",
};

const authStack = new ReportsAuthStack(app, "ReportsAuthStack", { env });
const storageStack = new ReportsStorageStack(app, "ReportsStorageStack", { env });

const dbStack = new ReportsDatabaseStack(app, "ReportsDatabaseStack", { env });

const apiStack = new ReportsApiStack(app, "ReportsApiStack", {
  env,
  reportsTable: dbStack.reportsTable,
  userProfilesTable: dbStack.userProfilesTable,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  logosBucket: storageStack.logosBucket,
});

// ReportsFrontendStack — Phase 5, not implemented yet (still an empty placeholder class)
new ReportsFrontendStack(app, "ReportsFrontendStack", { env });

app.synth();
