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

export async function saveReport(
  data: Omit<SavedReport, "reportId" | "createdAt">
): Promise<SavedReport> {
  const reportId = uuidv4();
  const createdAt = new Date().toISOString();
  const item: SavedReport = { ...data, reportId, createdAt };

  await client.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(item),
    })
  );

  return item;
}

export async function getReportsByUser(userId: string): Promise<SavedReport[]> {
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "DateIndex",
      KeyConditionExpression: "userId = :uid",
      ExpressionAttributeValues: marshall({ ":uid": userId }),
      ScanIndexForward: false, // Newest first (FR-03: reverse chronological)
      Limit: 30, // FR-03: last 30 reports per user
    })
  );

  return (result.Items ?? []).map((item) => unmarshall(item) as SavedReport);
}

export async function deleteReport(userId: string, reportId: string): Promise<void> {
  await client.send(
    new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ userId, reportId }),
    })
  );
}
