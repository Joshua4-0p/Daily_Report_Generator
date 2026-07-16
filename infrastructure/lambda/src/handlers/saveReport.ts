import {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { saveReport } from "../utils/dynamodb";

export async function saveReportHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Invalid JSON in request body" }),
    };
  }
  const { employeeName, date, rawInput, formattedReport } = body as {
    employeeName?: string;
    date?: string;
    rawInput?: string;
    formattedReport?: string;
  };

  if (!employeeName || !date || !rawInput || !formattedReport) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Missing required fields" }),
    };
  }

  const userId = employeeName.toLowerCase().trim().replace(/\s+/g, "_");
  const saved = await saveReport({ userId, employeeName, date, rawInput, formattedReport });

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, report: saved }),
  };
}
