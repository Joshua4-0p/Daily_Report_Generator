import {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const TABLE = process.env.USER_PROFILES_TABLE ?? "UserProfiles";
const BUCKET = process.env.LOGOS_BUCKET_NAME ?? "";

export async function getProfile(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;

  const result = await dynamo.send(
    new GetItemCommand({
      TableName: TABLE,
      Key: marshall({ userId }),
    })
  );

  if (!result.Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ success: false, error: "Profile not found" }),
    };
  }

  const profile = unmarshall(result.Item);

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
