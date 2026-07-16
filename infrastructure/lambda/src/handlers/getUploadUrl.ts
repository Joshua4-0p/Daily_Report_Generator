import {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const BUCKET = process.env.LOGOS_BUCKET_NAME ?? "";

const ALLOWED_FILE_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];

export async function getUploadUrl(
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
  const { fileType } = body as { fileType?: string };

  if (!fileType || !ALLOWED_FILE_TYPES.includes(fileType)) {
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
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, uploadUrl: signedUrl, key }),
  };
}
