import {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const TABLE = process.env.USER_PROFILES_TABLE ?? "UserProfiles";

export async function saveProfile(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Invalid JSON in request body" }),
    };
  }
  const { fullName, email, phone, companyName, department, logoKey, defaultTemplate } = body as {
    fullName?: string;
    email?: string;
    phone?: string;
    companyName?: string;
    department?: string;
    logoKey?: string;
    defaultTemplate?: string;
  };

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

  await client.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: marshall(profile),
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, profile }),
  };
}
