import {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { deleteReport } from "../utils/dynamodb";

export async function deleteReportHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
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
