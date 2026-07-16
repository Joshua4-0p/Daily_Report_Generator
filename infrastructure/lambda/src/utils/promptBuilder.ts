export interface ReportInput {
  employeeName: string;
  date: string;
  tasksCompleted: string;
  tomorrowPlan?: string;
  challenges?: string;
}

export function buildPrompt(input: ReportInput): string {
  const { employeeName, date, tasksCompleted, tomorrowPlan, challenges } = input;

  const challengeText =
    challenges && challenges.trim().length > 0 ? challenges.trim() : null;

  const tomorrowText =
    tomorrowPlan && tomorrowPlan.trim().length > 0 ? tomorrowPlan.trim() : null;

  return `You are a professional workplace assistant that formats daily work reports.

Convert the following raw notes into a clean, structured daily report. Use professional workplace language. Keep each bullet point concise (one line maximum).

Employee: ${employeeName}
Date: ${date}

RAW NOTES:
Tasks done today: ${tasksCompleted}
${tomorrowText ? `Plans for tomorrow: ${tomorrowText}` : "Plans for tomorrow: Not specified"}
${challengeText ? `Challenges encountered: ${challengeText}` : "Challenges encountered: None mentioned"}

Format the output EXACTLY as follows (use these exact section headers in uppercase):

TASKS COMPLETED TODAY:
• [bullet points of tasks done today, converted to professional language]

PLANNED FOR TOMORROW:
• [bullet points of tomorrow's plans, or "To be determined" if none provided]

CHALLENGES & BLOCKERS:
${challengeText ? "• [professional description of the challenge]" : "None reported."}

OVERALL STATUS:
[Single sentence professional status, e.g. "On track — all planned tasks completed." or "Slightly delayed — awaiting dependency resolution."]

Important rules:
- Convert casual language to professional workplace language
- Keep bullet points concise and action-oriented
- If no challenges were mentioned, write exactly "None reported." under CHALLENGES & BLOCKERS
- Do not add any text before TASKS COMPLETED TODAY or after the OVERALL STATUS line
- Do not use markdown formatting (no bold, no headers with #)`;
}
