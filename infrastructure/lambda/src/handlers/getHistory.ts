import {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { getReportsByUser } from "../utils/dynamodb";

export async function getHistory(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
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
