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
      bucketName: `daily-report-logos-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        {
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
