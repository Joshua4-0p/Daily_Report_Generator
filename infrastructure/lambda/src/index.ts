import {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { generateReport } from "./handlers/generateReport";
import { saveReportHandler } from "./handlers/saveReport";
import { getHistory } from "./handlers/getHistory";
import { deleteReportHandler } from "./handlers/deleteReport";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Content-Type": "application/json",
};

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> => {
  // Handle CORS preflight
  if (event.requestContext.http.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  try {
    const routeKey = event.routeKey; // e.g. "POST /api/generate"
    let result: APIGatewayProxyStructuredResultV2;

    switch (routeKey) {
      case "POST /api/generate":
        result = await generateReport(event);
        break;
      case "POST /api/reports":
        result = await saveReportHandler(event);
        break;
      case "GET /api/reports":
        result = await getHistory(event);
        break;
      case "DELETE /api/reports/{reportId}":
        result = await deleteReportHandler(event);
        break;
      default:
        result = {
          statusCode: 404,
          body: JSON.stringify({ success: false, error: "Route not found" }),
        };
    }

    // Inject CORS headers into every response
    return {
      ...result,
      headers: { ...result.headers, ...CORS_HEADERS },
    };
  } catch (error) {
    console.error("Lambda error:", error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: "Internal server error" }),
    };
  }
};
