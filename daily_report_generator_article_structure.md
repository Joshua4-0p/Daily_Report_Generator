# Article Structure — AWS Builder Center Submission
## Weekend Productivity Challenge: Daily Report Generator

**Required title format:** `Weekend Productivity Challenge: Daily Report Generator`
**Required tag:** `#productivity`
**Minimum word count:** 500 words
**Deadline:** July 13, 2026 at 1:00 PM PT

---

> This file is your writing guide. Each section includes the heading to use, what to write about, key points to hit, and a suggested word count. Write the article in your own voice — conversational but professional. Avoid AI-sounding sentence openers. The article should read as a builder reflecting on their weekend project.

---

## Article Title

```
Weekend Productivity Challenge: Daily Report Generator
```

---

## Opening Hook (50–80 words)

Start with the pain, not the solution. Open with the specific moment every professional recognizes:

> Something like: "Every day at Digisol Group, around 5 PM, the same thing happens. I close my laptop having done actual work — squashed a bug, unblocked a colleague, deployed something — and then I open a blank daily report form and stare at it. The work was real. Writing about it in 'professional format' is somehow harder than the work itself."

Make it personal and specific. Mention Digisol Group or the AWS community context if relevant. Do not open with "In today's fast-paced world" or any variation.

---

## Section 1: Vision & What the App Does

**Heading:** `What I Built`

**Word count target:** 120–150 words

Write about:
- The specific problem: converting raw daily work notes into structured professional reports
- Who this is for: developers, interns, team members in companies that require daily/weekly report submissions
- What the tool does from the user perspective (3 sentences max):
  - User opens the app, types their day in plain language
  - Clicks Generate Report
  - Gets a structured report with four sections (Tasks Completed, Planned for Tomorrow, Challenges & Blockers, Overall Status) — ready to copy and submit
- Smart behavior to highlight: if the user didn't mention any challenges, the AI automatically writes "None reported" — no need for the user to think about that section at all
- One sentence on where it's live: link to the Amplify URL or GitHub repo

**Do not** list bullet points of features here. Write in flowing prose.

---

## Section 2: How I Built It

**Heading:** `The Build Process`

**Word count target:** 200–250 words

Write about the development journey — decisions made, things that surprised you, how you organized your time. This section is what makes the article genuinely useful to other builders.

Cover these points (in your own words, not as bullet points):

**Why serverless:** Explain why you chose Lambda + API Gateway over a traditional Express server. Frame it around the challenge constraint (free tier, quick deployment, no server management).

**The prompt engineering challenge:** This is the most interesting technical decision. Explain how you structured the AI prompt so it handles the "no challenges" case gracefully — if the user leaves the challenges field blank, the prompt already tells the model to write "None reported." You didn't want the user to have to think about empty fields. Mention that getting this prompt right took a few iterations — explain what the first version produced and why it wasn't right, and what you changed.

**The Converse API decision:** Mention that you used Amazon Bedrock's Converse API instead of model-specific APIs. Explain why: it gave you the flexibility to switch between Amazon Nova Lite and Claude Haiku without changing any application code — just an environment variable. This was a forward-thinking decision given the quota uncertainty.

**One honest challenge or mistake:** Pick one real thing that took longer than expected or went wrong. This makes the article credible. Examples: CDK CORS configuration, Lambda cold starts being longer than expected, esbuild bundling issues, the DynamoDB GSI not being available immediately after deployment.

---

## Section 3: AWS Services Used / Architecture Overview

**Heading:** `AWS Services & Architecture`

**Word count target:** 150–180 words

Write a short architecture overview paragraph, then list the services:

**Opening paragraph (3–4 sentences):** Describe the architecture at a high level — serverless, three-tier, single region. "The entire backend runs without a single server to manage..." Mention that the frontend is a React app hosted on Amplify, API calls go to API Gateway which triggers Lambda, and Lambda calls Bedrock for AI and DynamoDB for storage.

**Services list (use a short table or a brief bulleted list):**

| Service | What it does in this project |
|---|---|
| AWS Amplify | Hosts the React frontend with CI/CD from GitHub |
| Amazon API Gateway (HTTP API) | Exposes 4 routes: generate, save, list history, delete |
| AWS Lambda (Node.js 24.x) | Handles all backend logic — prompt building, Bedrock calls, DynamoDB operations |
| Amazon Bedrock (Nova Lite) | AI text generation via the Converse API — converts raw notes to formatted reports |
| Amazon DynamoDB | Stores report history; on-demand capacity to keep costs near zero |

**Cost line:** One sentence stating estimated cost at your usage level: "At 100 reports per day, the total AWS bill stays under $2/month — mostly Bedrock token costs."

**Diagram:** Insert the architecture diagram image here. Create the diagram from `cloud_architecture_diagram.md` using draw.io, Lucidchart, or AWS Architecture Center icons.

---

## Section 4: What I Learned

**Heading:** `What I Learned`

**Word count target:** 120–150 words

Write 3–4 genuine reflections. These should be specific, not generic ("I learned how to use Lambda"). Examples of specific insights:

1. **The Converse API is underappreciated.** Before this project, when you used Bedrock you were calling model-specific invoke endpoints. The Converse API gives you a single unified interface that works across foundation models — you don't have to rewrite your application every time you switch models. This changes how you'll approach Bedrock in future projects.

2. **Prompt engineering is real engineering.** Getting the model to produce consistent output structure — same four sections, every time, without markdown formatting — required deliberate prompt design. Temperature matters (0.3 gives much more consistent formatting than 0.7). Adding explicit negative constraints ("do not add any text before TASKS COMPLETED TODAY") eliminated most edge cases.

3. **CDK makes infrastructure repeatable.** Write about the experience of having your entire cloud infrastructure in code — being able to tear it down and recreate it, or see exactly what's deployed by reading a TypeScript file.

4. **(Optional)** One observation about building quickly — what you would do differently if you had a week instead of a weekend.

---

## Section 5: Link to App or Repo

**Heading:** `Try It Yourself`

**Word count target:** 30–50 words

Include both:
- Live app URL: `https://main.d<xxxx>.amplifyapp.com` (your Amplify URL)
- GitHub repo: `https://github.com/<your-username>/daily-report-generator`

Write one sentence inviting readers to try it or fork it:

> "The full source code is available on GitHub — the CDK infrastructure, Lambda handlers, and React frontend. If you're required to submit daily reports at your company, this might save you ten minutes every day."

---

## Full Article Word Count Estimate

| Section | Target |
|---|---|
| Opening hook | 70 words |
| What I Built | 140 words |
| The Build Process | 225 words |
| AWS Services & Architecture | 165 words |
| What I Learned | 135 words |
| Try It Yourself | 40 words |
| **Total** | **~775 words** |

This comfortably clears the 500-word minimum while remaining focused and readable.

---

## Writing Style Reminders

- Write in first person: "I built", "I decided", "I learned"
- No passive voice: "the report is generated" → "the model generates the report"
- No em dashes (—) in the final article — use commas or periods instead
- No AI-sounding openers: avoid "In this article", "I'm excited to share", "Let's dive in"
- Be specific about numbers: "4 AWS services", "512 MB Lambda memory", "30-second timeout", "$0.38/month"
- Screenshots help: include at least 2 screenshots — the generator page with a filled form and the formatted output

---

## Pre-Submission Checklist

- [ ] Title includes "Weekend Productivity Challenge: Daily Report Generator"
- [ ] Tag #productivity is added
- [ ] Article is 500+ words
- [ ] All 5 required sections are present (Vision, How I Built It, AWS Services, What I Learned, Link)
- [ ] Architecture diagram image is embedded
- [ ] At least one screenshot of the working app is included
- [ ] GitHub repo link is public and accessible
- [ ] Amplify live URL is working and publicly accessible
- [ ] Article is published on AWS Builder Center (not just saved as draft)
- [ ] Submitted before July 13, 2026 at 1:00 PM PT
