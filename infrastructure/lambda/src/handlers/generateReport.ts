import {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { buildPrompt } from "../utils/promptBuilder";
import { callBedrock } from "../utils/bedrock";

export async function generateReport(
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
  const { employeeName, date, tasksCompleted, tomorrowPlan, challenges } = body as {
    employeeName?: string;
    date?: string;
    tasksCompleted?: string;
    tomorrowPlan?: string;
    challenges?: string;
  };

  if (!employeeName || !date || !tasksCompleted) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: "Missing required fields: employeeName, date, tasksCompleted",
      }),
    };
  }

  const prompt = buildPrompt({ employeeName, date, tasksCompleted, tomorrowPlan, challenges });
  const report = await callBedrock(prompt);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, report }),
  };
}
