import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

// ADR: on-demand (PAY_PER_REQUEST) billing over provisioned capacity.
// Why: workload is bursty and low-volume at MVP scale (~3,000 reports/month);
// on-demand avoids idle-capacity cost and satisfies the <$10/month target (NFR-02).
export class ReportsDatabaseStack extends cdk.Stack {
  public readonly reportsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.reportsTable = new dynamodb.Table(this, "ReportsTable", {
      tableName: "DailyReports",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "reportId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: false,
    });

    // GSI: query all reports for a user sorted by date
    this.reportsTable.addGlobalSecondaryIndex({
      indexName: "DateIndex",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "date", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

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
