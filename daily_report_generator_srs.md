# Software Requirements Specification
## Daily Report Generator

**Version:** 2.0
**Challenge:** AWS Builder Center — Weekend Productivity Challenge
**Date:** July 2026
**Author:** Joshua Tiaya Fotseu

---

## 1. Introduction

### 1.1 Purpose
This document specifies the functional and non-functional requirements for the Daily Report Generator — an AI-powered productivity tool that converts plain-text daily work notes into structured, professional daily reports using AWS serverless infrastructure. Version 2.0 extends the original MVP with user authentication, company branding, personalised dashboards, document templates, and PDF download.

### 1.2 Product Description
The Daily Report Generator addresses a universal workplace friction point: the daily or end-of-day report that virtually every company requires from its employees. Workers are productive during the day but struggle to translate their raw, informal thoughts into the structured format HR, managers, or team leads expect. This tool takes plain natural language input and returns a professionally formatted, branded daily report in seconds — rendered on the employee's chosen document template and downloadable as a PDF.

Any employee at any company can register, upload their company logo, and immediately start generating branded reports. Each user has a personalised history of reports and a dashboard showing their recent activity.

### 1.3 Intended Audience
- Software developers and interns
- Project managers and team leads
- Any professional required to submit structured daily work reports
- Companies of any size wanting a lightweight branded reporting tool

### 1.4 Scope (Version 2.0)
Version 2.0 covers: user registration and authentication (Cognito), company branding (logo upload to S3), personalised dashboard with activity metrics, AI report generation (Claude Haiku 4.5 — quota approved), four downloadable PDF document templates, personalised report history, and report deletion. Email delivery, team dashboards, and Slack integration remain post-v2 features.

---

## 2. AWS Services Used

The system uses 7 AWS services, each chosen for a specific role. All services are within free tier or near-zero cost for MVP usage.

### Service Table

| AWS Service | Tier Used | Role in the Application |
|---|---|---|
| **AWS Amplify** | Free Tier | Hosts and serves the React frontend. Provides CI/CD pipeline connected to GitHub. Handles HTTPS, CDN distribution, and custom domain support. |
| **Amazon Cognito** | Free Tier (50K MAU/month) | Manages user registration and authentication. Stores email, password (hashed), and basic profile. Issues JWT tokens (ID token + access token) used to authorize all protected API routes. |
| **Amazon S3** | Free Tier | Stores company logo images uploaded during registration. Lambda generates pre-signed PUT URLs so the frontend uploads directly to S3 without routing through Lambda. Logos are served via S3 public URL or pre-signed GET URL. |
| **Amazon API Gateway** (HTTP API) | Free Tier (first 12 months) | Exposes all backend routes. Protected routes use a Cognito JWT authorizer — API Gateway validates the token before forwarding to Lambda. Public routes (health check) have no authorizer. HTTP API chosen over REST API for 70% cost reduction. |
| **AWS Lambda** (Node.js 24.x) | Free Tier | Single Lambda function handles all backend logic: AI report generation, user profile CRUD, S3 pre-signed URL generation, DynamoDB operations, and request routing. |
| **Amazon Bedrock** | Pay per token | AI text generation using the Converse API. Active model: `anthropic.claude-haiku-4-5-20251001-v1:0` (quota approved July 2026). Model ID is environment-variable driven — switchable without code changes. |
| **Amazon DynamoDB** | Free Tier | Two tables: `DailyReports` (report history, PK: userId + SK: reportId, GSI: DateIndex) and `UserProfiles` (company branding + profile data, PK: userId). On-demand capacity on both tables. |

> **Total services: 7** (Amplify + Cognito + S3 + API Gateway + Lambda + Bedrock + DynamoDB)

### Estimated Monthly Cost (Version 2.0)

| Service | Free Tier Coverage | Estimated Cost (100 reports/day, 50 users) |
|---|---|---|
| Amplify | 1000 build min, 15 GB storage, 150 GB transfer | $0.00 |
| Cognito | 50,000 MAU free | $0.00 |
| S3 | 5 GB storage, 20K GET, 2K PUT free | $0.00 |
| API Gateway (HTTP) | 1M requests free (12 months) | $0.00 |
| Lambda | 1M requests + 400K GB-seconds free | $0.00 |
| Bedrock (Claude Haiku 4.5) | No free tier | ~$0.75/month |
| DynamoDB | 25 GB storage, 25 RCU/WCU free | $0.00 |
| **Total** | | **~$0.75 – $3.00/month** |

Cost calculation for Claude Haiku 4.5:
- Input: $0.00025 per 1K tokens × ~500 tokens/report × 3000 reports/month = $0.375
- Output: $0.00125 per 1K tokens × ~400 tokens/report × 3000 reports/month = $1.50
- Note: Claude Haiku 4.5 produces higher quality output than Nova Lite — the cost difference (~$0.37 more) is justified for a production tool
- Total Bedrock: ~$0.75–$1.88/month

Still under the $10/month budget constraint.

---

## 3. Functional Requirements

### FR-01: Report Generation
**Priority:** Must Have

The system shall allow an authenticated user to generate a structured daily report by providing:
- Tasks completed today (required, minimum 10 characters — plain natural language)
- Plans for tomorrow (optional)
- Challenges or blockers encountered (optional)

The employee name, department, and company are pre-filled from the authenticated user's profile — the user does not re-enter these on the generator form.

The system shall use Amazon Bedrock (Claude Haiku 4.5) to transform input into a professionally formatted report with four sections:
1. **Tasks Completed Today** — bullet-point list, professional language
2. **Planned for Tomorrow** — bullet-point list, or "To be determined" if none provided
3. **Challenges & Blockers** — professional description if provided; "None reported." if field was empty
4. **Overall Status** — one-line professional status sentence

### FR-02: Report Display and Download
**Priority:** Must Have

After generation, the system shall:
- Display the formatted report in the selected document template preview (with company logo, employee name, department, date)
- Provide a one-click **Download as PDF** button that renders the report in the selected template and downloads a `.pdf` file
- Provide a one-click **Copy to clipboard** button for the raw report text
- Allow the user to save the report to history
- Allow the user to regenerate the report (same form inputs, new AI call)

### FR-03: Document Templates
**Priority:** Must Have

The system shall provide four document template styles. Each template renders the report as a styled PDF document containing:
- Company logo (from user profile)
- Company name and employee name
- Employee department and report date
- All four report sections with appropriate formatting

The four templates are:

| Template | Style Description |
|---|---|
| **Classic** | White background, minimal borders, company logo top-left, clean serif typography |
| **Professional** | Dark navy header (#252F3E) with white company logo and employee name, orange section headers |
| **Modern** | Left orange accent bar, company info in sidebar column, report content in main column |
| **Corporate** | Full letterhead style with top and bottom borders, centered company logo, formal memo layout |

The user selects a default template from the Template page. The selected template is applied automatically when generating and downloading reports. The user may change the template at any time.

### FR-04: User Registration
**Priority:** Must Have

The system shall allow a new user to register by providing:
- Full name (required, minimum 2 characters)
- Email address (required, valid email format — used as Cognito username)
- Phone number (required, E.164 format validation)
- Company name (required)
- Department (required)
- Company logo (required, image file: PNG/JPG/SVG, max 2MB — uploaded to S3)
- Password (required, minimum 8 characters, must contain uppercase, lowercase, and number)
- Confirm password (required, must match password)

After successful registration:
1. Cognito creates the user account
2. A verification email is sent to the provided email address
3. The user profile (name, phone, company name, department, logo S3 URL) is stored in the `UserProfiles` DynamoDB table
4. The user is redirected to a verification confirmation page

### FR-05: Email Verification
**Priority:** Must Have

After registration, the user must verify their email address via a 6-digit OTP code sent to their email by Cognito. The verification page shall provide:
- A 6-digit code input field
- A "Verify" button
- A "Resend code" option
- Redirect to login on successful verification

### FR-06: User Login
**Priority:** Must Have

The system shall allow a registered and verified user to log in by providing:
- Email address
- Password

On successful login, Cognito issues a JWT ID token and access token. The frontend stores tokens in memory (not localStorage). The user is redirected to the Dashboard page. On failed login, a user-friendly error is shown (invalid credentials — no detail about which field is wrong, for security).

### FR-07: Session Management
**Priority:** Must Have

- JWT tokens expire after 1 hour (Cognito default)
- On token expiry, the frontend silently refreshes using the Cognito refresh token
- If the refresh token is expired or invalid, the user is redirected to the login page
- A "Sign out" option in the sidebar clears all tokens and redirects to the home page

### FR-08: Dashboard
**Priority:** Should Have

The authenticated dashboard shall display:
- **Total reports this month** — count of saved reports with `date` in the current calendar month
- **Reports this week** — count of saved reports with `date` in the current calendar week
- **Status breakdown** — count of reports with "On track" vs "Delayed" overall status (parsed from `formattedReport`)
- **Recent reports** — list of the 5 most recent saved reports with date, truncated task preview, and a quick-download button

Dashboard data is loaded from the `DailyReports` DynamoDB table filtered by the authenticated user's `userId`.

### FR-09: Report History
**Priority:** Must Have

The authenticated history page shall:
- Display all saved reports for the authenticated user in reverse chronological order (newest first)
- Show report date, truncated tasks preview
- Allow the user to open any report in full view (dialog/modal)
- Provide a **Download PDF** button for any past report (renders in the user's current default template)
- Allow the user to delete any past report
- Support filtering by date range (this week / this month / all time)

### FR-10: User Profile
**Priority:** Must Have

The authenticated profile section shall allow the user to view and edit:
- Full name
- Phone number
- Company name
- Department
- Company logo (re-upload)
- Default document template selection

Password change is handled via Cognito's standard flow (separate from the profile form).

### FR-11: Home Page (Public, Unauthenticated)
**Priority:** Must Have

The public home page is a single scrollable page with four anchor sections navigable from the top navbar tabs:
- **Home** — hero section with headline, subtitle, and CTA buttons ("Get Started" / "Sign In")
- **Features** — three feature cards (AI-powered, Branded Templates, Instant PDF)
- **About** — brief description of the tool and the builder
- **Contact** — simple contact information or a contact form link

Clicking any navbar tab smoothly scrolls to the corresponding section. Authenticated users are redirected to the Dashboard when they visit the home page.

### FR-12: Input Validation
**Priority:** Must Have

All forms shall validate inputs using Zod schemas with react-hook-form. Specific rules:
- Registration: all fields required, email format, password strength, file type/size for logo, password match
- Login: email format, password not empty
- Generator: tasks field minimum 10 characters
- Profile: same rules as registration minus password fields

Invalid inputs display inline error messages below each field. The submit button is disabled until the form is valid.

### FR-13: Loading States and Error Handling
**Priority:** Must Have

- All async operations display a loading indicator (skeleton or spinner)
- All API errors display a toast notification with a user-friendly message
- Raw AWS error messages and stack traces are never shown to the user
- Network errors show: "Connection error. Please check your internet and try again."
- Auth errors show: "Invalid email or password." (no specificity for security)
- Bedrock errors show: "Report generation failed. Please try again in a moment."

### FR-14: Responsive Design
**Priority:** Should Have

The frontend shall render correctly on desktop (1280px+), tablet (768px–1279px), and mobile (375px–767px). The sidebar collapses to a bottom navigation bar on mobile.

---

## 4. Non-Functional Requirements

### NFR-01: Performance
- Report generation response time under 10 seconds for 95% of requests
- Dashboard and history pages load within 2 seconds for up to 30 records
- PDF render and download completes within 3 seconds client-side
- Frontend initial page load under 3 seconds on standard broadband

### NFR-02: Cost Efficiency
- Monthly AWS bill under $10 for up to 50 users generating 100 reports/day
- Lambda memory: 512 MB (sufficient, avoids 1024 MB cost)
- DynamoDB: on-demand capacity on both tables (no idle provisioned cost)
- API Gateway: HTTP API (70% cheaper than REST API)
- S3 logos: stored once per user, served via pre-signed URL (no egress charges for Lambda)
- Cognito: free under 50,000 MAU
- PDF rendering is done client-side (no server cost)

### NFR-03: Availability
- Target: 99.9% (inherited from AWS managed service SLAs — Cognito, Lambda, DynamoDB, API Gateway, S3 are all fully managed)

### NFR-04: Security
- All protected API routes require a valid Cognito JWT token validated by API Gateway JWT authorizer
- Lambda never receives unauthenticated requests on protected routes — JWT is validated at the API Gateway layer before forwarding
- Lambda IAM role follows least-privilege: specific Bedrock model ARN, specific DynamoDB table ARNs, specific S3 bucket ARN only
- CORS is restricted to the Amplify domain only (not wildcard `*`)
- JWT tokens stored in memory only — never in localStorage or cookies (XSS protection)
- S3 company logo uploads use pre-signed PUT URLs (direct browser-to-S3, no credentials in frontend)
- S3 bucket has no public access — logos accessed via pre-signed GET URLs only
- Passwords managed entirely by Cognito — never stored in DynamoDB or Lambda

### NFR-05: Scalability
- Lambda scales to 1,000 concurrent executions automatically
- DynamoDB on-demand scales automatically
- Cognito scales to 50,000 MAU on free tier
- Amplify CDN scales automatically

### NFR-06: Maintainability
- All infrastructure defined in CDK TypeScript — no manual console configuration
- Lambda handlers are modular (one file per route handler, separate utility files)
- Bedrock model ID externalized as environment variable
- Cognito User Pool ID and Client ID stored as CDK outputs and Amplify environment variables

### NFR-07: Bedrock Model (Active)
- Active model: `anthropic.claude-haiku-4-5-20251001-v1:0` (quota approved)
- The Converse API is used — switching to a different model requires only changing the `BEDROCK_MODEL_ID` environment variable and redeploying the API stack

---

## 5. System Constraints

- **Region:** All AWS resources deployed in `us-east-1`
- **Lambda runtime:** `nodejs24.x`
- **AWS SDK:** v3 (inside Lambda)
- **IaC:** AWS CDK TypeScript only
- **Frontend build tool:** Vite
- **CSS:** Tailwind CSS v3.4.x (shadcn-compatible)
- **Auth SDK:** `aws-amplify` v6 (frontend Cognito integration)
- **PDF rendering:** `@react-pdf/renderer` v3 (client-side, no server cost)
- **Logo upload:** Direct browser-to-S3 via pre-signed URL (not through Lambda)
- **Node.js:** >= 20.x on development machine

---

## 6. Out of Scope (Post-v2)

- Email delivery of reports
- Team or manager dashboard views (multi-user reporting)
- Slack or Microsoft Teams integration
- Report analytics and trend visualizations over time
- Mobile native app (iOS/Android)
- Custom user-defined report templates
- Multi-language support