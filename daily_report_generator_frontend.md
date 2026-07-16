# Frontend Design Specification — Version 2.0
## Daily Report Generator

**Stack:** React 18 + Vite (TypeScript) · Tailwind CSS v3.4 · shadcn/ui · React Router DOM v6
**Auth:** aws-amplify v6 (Cognito) · **PDF:** @react-pdf/renderer v3

---

## Updated Dependency List

```bash
# Core (unchanged)
npm install react-router-dom @tanstack/react-query zustand zod \
  react-hook-form @hookform/resolvers date-fns sonner lucide-react \
  axios clsx tailwind-merge

# NEW in v2
npm install aws-amplify                    # Cognito auth (signUp, signIn, signOut, JWT)
npm install @react-pdf/renderer            # Client-side PDF generation and download
npm install react-dropzone                 # Drag-and-drop logo upload on register page

# Remove (no longer needed)
# Nothing removed — all original deps remain
```

shadcn components to add beyond original list:
```bash
npx shadcn@latest add avatar progress tabs scroll-area sheet
```

---

## Color System (unchanged from v1)

```typescript
// tailwind.config.ts — same as before
colors: {
  "aws-navy":        "#252F3E",
  "aws-navy-light":  "#37475A",
  "aws-orange":      "#FF9900",
  "aws-orange-light":"#FFAC31",
  "aws-ink":         "#333E48",
  "aws-white":       "#FFFFFF",
  "aws-gray-50":     "#F8F9FA",
  "aws-gray-100":    "#EDF0F2",
  "aws-gray-200":    "#D5D8DC",
  "aws-gray-500":    "#7F8C9A",
}
```

---

## Application States and Routing

The app has two distinct states based on auth status:

```
UNAUTHENTICATED               AUTHENTICATED
/                 Home         /dashboard        Dashboard
/register         Register     /generator        Generator
/login            Login        /template         Template picker
/verify           OTP verify   /history          History
                               /profile          Profile
```

React Router with a `ProtectedRoute` wrapper redirects unauthenticated users to `/login`. Authenticated users visiting `/`, `/login`, or `/register` are redirected to `/dashboard`.

### App.tsx Router Structure

```tsx
<BrowserRouter>
  <Routes>
    {/* Public routes */}
    <Route path="/" element={<PublicRoute><Home /></PublicRoute>} />
    <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
    <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
    <Route path="/verify" element={<VerifyEmail />} />

    {/* Authenticated routes — all wrapped in AuthenticatedLayout (sidebar) */}
    <Route element={<ProtectedRoute><AuthenticatedLayout /></ProtectedRoute>}>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/generator" element={<Generator />} />
      <Route path="/template" element={<TemplatePicker />} />
      <Route path="/history" element={<History />} />
      <Route path="/profile" element={<Profile />} />
    </Route>
  </Routes>
</BrowserRouter>
```

`PublicRoute`: if user is already authenticated, redirect to `/dashboard`.
`ProtectedRoute`: if user is not authenticated, redirect to `/login`.

---

## Amplify Configuration (`src/lib/amplify.ts`)

```typescript
import { Amplify } from "aws-amplify";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
      signUpVerificationMethod: "code",
    },
  },
});
```

Import this file in `main.tsx` before anything else:
```typescript
import "./lib/amplify";   // Must be first import
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
```

---

## Auth Utility Hook (`src/hooks/useAuth.ts`)

```typescript
import { signUp, signIn, signOut, confirmSignUp,
         getCurrentUser, fetchAuthSession } from "aws-amplify/auth";

export function useAuth() {
  const register = async (email, password, fullName, phone) => {
    return signUp({
      username: email,
      password,
      options: {
        userAttributes: { email, name: fullName, phone_number: phone },
      },
    });
  };

  const login = async (email: string, password: string) => {
    return signIn({ username: email, password });
  };

  const logout = async () => signOut();

  const verify = async (email: string, code: string) =>
    confirmSignUp({ username: email, confirmationCode: code });

  const getToken = async (): Promise<string | null> => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString() ?? null;
    } catch {
      return null;
    }
  };

  return { register, login, logout, verify, getToken };
}
```

Axios interceptor in `src/api/client.ts` — auto-attaches JWT to every request:
```typescript
import axios from "axios";
import { fetchAuthSession } from "aws-amplify/auth";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 35000,
});

api.interceptors.request.use(async (config) => {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch { /* unauthenticated — no header added */ }
  return config;
});

export default api;
```

---

## Updated Zustand Store (`src/store/useUIStore.ts`)

```typescript
interface UIStore {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  // Authenticated user profile (loaded after login)
  userProfile: UserProfile | null;
  setUserProfile: (profile: UserProfile | null) => void;

  // Selected template (persisted in profile, cached locally)
  selectedTemplate: "classic" | "professional" | "modern" | "corporate";
  setSelectedTemplate: (t: UIStore["selectedTemplate"]) => void;

  // Last generated report (for generator page)
  lastGeneratedReport: string | null;
  setLastGeneratedReport: (r: string | null) => void;

  // Draft form inputs (preserve across navigation)
  draftForm: Partial<GeneratorFormValues> | null;
  setDraftForm: (v: Partial<GeneratorFormValues> | null) => void;
}
```

---

## Page 1: Home Page (Public — Single Page, Anchor Navigation)

**File:** `src/pages/Home.tsx`
**Route:** `/`
**Layout:** Full-page scroll with sticky navbar. Four sections, each with an `id` matching a nav tab.

### Navbar (Public)

```
[Logo: Zap orange + "DailyReport AI" white text]
[Home]  [Features]  [About]  [Contact]          [Sign In]  [Get Started →]
```

- Background: `bg-aws-navy`
- Clicking any tab calls `document.getElementById(id).scrollIntoView({ behavior: "smooth" })`
- Active tab (based on IntersectionObserver): `text-aws-orange`
- "Sign In" → `/login` (outlined button)
- "Get Started" → `/register` (orange filled button)
- Sticky: `sticky top-0 z-50`

### Section 1: Hero (`id="home"`)

```
[full-width, bg-aws-navy, py-24]

"Turn your daily work notes into"
"professional reports in seconds."

"Write freely in plain language.
 Our AI formats it into a structured, branded
 daily report — ready to download as PDF."

[Get Started Free →]   [See how it works ↓]

[Badge: Powered by Amazon Bedrock Claude Haiku 4.5]
```

- Headline: `text-5xl font-bold text-white leading-tight` (desktop), `text-3xl` (mobile)
- Subtitle: `text-gray-300 text-xl mt-6 max-w-2xl`
- CTA primary: `bg-aws-orange text-aws-navy font-semibold px-8 py-4 rounded-lg text-lg`
- Badge: small pill, `bg-aws-navy-light text-aws-orange border border-aws-orange text-xs px-3 py-1`

### Section 2: Features (`id="features"`)

Three feature cards in a responsive grid `grid-cols-1 md:grid-cols-3 gap-6`:

| Card | Icon (Lucide) | Title | Description |
|---|---|---|---|
| 1 | `Sparkles` | AI-Powered Formatting | Write in plain language. Claude Haiku 4.5 structures it into a professional report. |
| 2 | `FileText` | Branded Templates | 4 document templates. Your company logo, name, and department on every report. |
| 3 | `Download` | Instant PDF Download | Download your report as a PDF in seconds. Saved to your history anytime. |

- Card: `<Card className="border-aws-gray-200 hover:border-aws-orange transition-colors p-6">`
- Icon circle: `bg-aws-orange/10 rounded-full p-3 w-12 h-12` with icon in `text-aws-orange`
- Section background: `bg-aws-gray-50 py-20`

### Section 3: About (`id="about"`)

```
[bg-white py-20]

Two-column layout (text left, image/illustration right on desktop):

Left:
  "Built for professionals everywhere"
  "Daily reports are a universal workplace requirement.
   DailyReport AI was built during the AWS Weekend
   Productivity Challenge to solve the friction of
   translating a productive day into a formatted document."
  "Built on AWS — Amplify · Lambda · Bedrock · Cognito · DynamoDB"
  [AWS logo badges: small service icons in a row]

Right:
  [Before/After card showing raw input → formatted output]
```

### Section 4: Contact (`id="contact"`)

```
[bg-aws-navy py-20 text-center]

"Have questions or feedback?"
"Reach out at: joshuatiayafotseu@example.com"
[GitHub Repo →]   [AWS Builder Center Article →]

[Small footer: Built for AWS Weekend Productivity Challenge · July 2026]
```

---

## Page 2: Register (`/register`)

**File:** `src/pages/Register.tsx`
**Layout:** Centered card, max-width 560px, white background on gray-50 page

### Header

```
[Navbar: logo only, no nav tabs, "Already have an account? Sign in →"]
```

### Form Card

```
┌─────────────────────────────────────────────┐
│  Create your account                        │
│  Set up your profile and company branding   │
│                                             │
│  [Full name *]                              │
│  [Email address *]                          │
│  [Phone number *]  (E.164: +237XXXXXXXXX)  │
│  [Company name *]                           │
│  [Department *]                             │
│                                             │
│  Company Logo *                             │
│  ┌─────────────────────────────────────┐   │
│  │  [drag & drop or click to upload]   │   │
│  │  PNG, JPG, SVG · Max 2MB            │   │
│  └─────────────────────────────────────┘   │
│  [logo preview thumbnail when uploaded]     │
│                                             │
│  [Password *]                               │
│  [Confirm password *]                       │
│                                             │
│  [Create Account →]   (full-width orange)   │
│                                             │
│  Already have an account? [Sign in]         │
└─────────────────────────────────────────────┘
```

### shadcn Components
`Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`, `Input`, `Button`, `Card`, `CardHeader`, `CardContent`, `CardDescription`

### Logo Upload (react-dropzone)
```tsx
const { getRootProps, getInputProps, isDragActive, acceptedFiles } = useDropzone({
  accept: { "image/png": [], "image/jpeg": [], "image/svg+xml": [] },
  maxSize: 2 * 1024 * 1024, // 2MB
  maxFiles: 1,
});
```
Drop zone styling: `border-2 border-dashed border-aws-gray-200 rounded-lg p-8 text-center cursor-pointer hover:border-aws-orange transition-colors`
When `isDragActive`: `border-aws-orange bg-aws-orange/5`
When file accepted: show a `<img>` thumbnail 64×64px + filename + size + a remove `×` button

### Registration Flow (3 steps)
1. User fills form → validates with Zod → clicks "Create Account"
2. `signUp()` creates Cognito user → `POST /api/profile` saves extended profile to DynamoDB
3. Logo upload: `POST /api/upload-url` → get presigned URL → direct PUT to S3
4. On success: redirect to `/verify?email=<email>`

### Zod Schema
```typescript
const registerSchema = z.object({
  fullName:        z.string().min(2, "Name must be at least 2 characters"),
  email:           z.string().email("Enter a valid email address"),
  phone:           z.string().regex(/^\+\d{7,15}$/, "Use international format: +237XXXXXXXXX"),
  companyName:     z.string().min(2, "Company name is required"),
  department:      z.string().min(2, "Department is required"),
  password:        z.string().min(8).regex(/[A-Z]/, "Must contain uppercase")
                              .regex(/[a-z]/, "Must contain lowercase")
                              .regex(/[0-9]/, "Must contain a number"),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
```

---

## Page 3: Verify Email (`/verify`)

**File:** `src/pages/VerifyEmail.tsx`
**Layout:** Centered card, simple

```
┌──────────────────────────────────────────┐
│  Check your email                        │
│  We sent a 6-digit code to              │
│  joshua@digisol.com                      │
│                                          │
│  [  ] [  ] [  ] [  ] [  ] [  ]         │
│  (OTP input — auto-advance between cells) │
│                                          │
│  [Verify Email →]   (orange)             │
│                                          │
│  Didn't receive it? [Resend code]        │
└──────────────────────────────────────────┘
```

Use a single `<Input maxLength={6} />` styled as an OTP field or implement 6 individual single-char inputs. After successful verification, redirect to `/login` with a success toast: "Email verified! Please sign in."

---

## Page 4: Login (`/login`)

**File:** `src/pages/Login.tsx`
**Layout:** Centered card, max-width 420px

```
┌──────────────────────────────────────────┐
│  [Logo centered]                         │
│  Welcome back                            │
│  Sign in to your DailyReport AI account  │
│                                          │
│  [Email address]                         │
│  [Password]          [show/hide toggle]  │
│                                          │
│  [Sign In →]   (full-width orange)       │
│                                          │
│  Don't have an account? [Get started]    │
└──────────────────────────────────────────┘
```

**shadcn Components:** `Form`, `FormField`, `Input`, `Button`, `Card`

On successful login: fetch user profile (`GET /api/profile`), store in Zustand `setUserProfile()`, redirect to `/dashboard`.

On error: toast `"Invalid email or password."` — no detail about which field is wrong.

---

## Authenticated Layout (`src/components/layout/AuthenticatedLayout.tsx`)

All authenticated pages share a sidebar + topbar layout. Uses React Router's `<Outlet />`.

### Layout Structure

```
┌──────────────────────────────────────────────────────────────────┐
│ TOPBAR (bg-aws-navy, h-16)                                       │
│ [hamburger on mobile]  [page title]       [user avatar + name]  │
└──────────────────────────────────────────────────────────────────┘
┌────────────┬─────────────────────────────────────────────────────┐
│  SIDEBAR   │                                                     │
│  (w-64,    │   MAIN CONTENT AREA                                 │
│  bg-white, │   <Outlet />                                        │
│  border-r) │                                                     │
│            │                                                     │
│ [Logo]     │                                                     │
│ ─────────  │                                                     │
│ Dashboard  │                                                     │
│ Generator  │                                                     │
│ Template   │                                                     │
│ History    │                                                     │
│            │                                                     │
│ ─────────  │                                                     │
│ [Avatar]   │                                                     │
│ Profile    │                                                     │
│ Sign Out   │                                                     │
└────────────┴─────────────────────────────────────────────────────┘
```

### Sidebar Nav Items

```tsx
const navItems = [
  { label: "Dashboard",  icon: LayoutDashboard, href: "/dashboard" },
  { label: "Generator",  icon: FileText,        href: "/generator" },
  { label: "Template",   icon: Layout,          href: "/template"  },
  { label: "History",    icon: Clock,           href: "/history"   },
];
```

Active item: `bg-aws-orange/10 text-aws-orange border-r-2 border-aws-orange font-medium`
Inactive item: `text-aws-ink hover:bg-aws-gray-100 hover:text-aws-orange`

### Sidebar Bottom Section

```
[Avatar: company logo thumbnail, 40×40, rounded-full]
[User full name, text-sm font-medium]
[Department · Company, text-xs text-aws-gray-500]
─────────────────────────────────
[Profile settings →]
[Sign out]  (LogOut icon, text-red-500 on hover)
```

Avatar uses the company logo from user profile. If no logo loaded yet, fall back to user initials in `bg-aws-navy text-white` circle.

### Mobile Behavior
On screens < `md` (768px): sidebar is hidden, replaced by a bottom navigation bar with 4 icon tabs (Dashboard, Generator, Template, History). Sidebar opens as a `<Sheet>` (shadcn slide-over) when hamburger is tapped.

---

## Page 5: Dashboard (`/dashboard`)

**File:** `src/pages/Dashboard.tsx`

### Layout

```
"Good morning, Joshua 👋"
"Here's your report activity for July 2026"

┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Reports     │  │ This Week   │  │ On Track    │  │ Needs Attn  │
│ This Month  │  │             │  │             │  │             │
│   24        │  │    6        │  │   20        │  │    4        │
│ [+3 vs last │  │             │  │             │  │             │
│  week]      │  │             │  │             │  │             │
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘

Recent Reports
──────────────────────────────────────────────────────────
[Jul 14]  Fixed auth bug, wrote tests, reviewed PR...  [↓ PDF]
[Jul 13]  Deployed CDK infrastructure, tested APIs... [↓ PDF]
[Jul 12]  Built Lambda handlers for report generation [↓ PDF]
[Jul 11]  Set up CDK project, created DynamoDB tables [↓ PDF]
[Jul 10]  Project kickoff, AWS challenge research...  [↓ PDF]
```

### shadcn Components
`Card`, `CardHeader`, `CardContent`, `CardTitle`, `Skeleton` (loading), `Badge`, `Button`

### Metric Cards
- Background: `bg-white border border-aws-gray-200 rounded-xl p-6`
- Number: `text-3xl font-bold text-aws-ink`
- Label: `text-sm text-aws-gray-500`
- Trend badge (if data available): `<Badge className="bg-green-50 text-green-700">+3</Badge>`

### Recent Reports List
- Max 5 items, loaded from `GET /api/reports?userId=<userId>` (Limit: 5)
- Each row: date badge + truncated task preview + quick "↓ PDF" button
- "↓ PDF" triggers client-side PDF render in the user's current default template
- "View all →" link to `/history`

### Data Loading
Use TanStack Query:
```typescript
const { data, isLoading } = useQuery({
  queryKey: ["reports", userId],
  queryFn: () => api.get(`/api/reports?userId=${userId}`).then(r => r.data.reports),
});
```

Metrics are derived from the reports array on the client (no extra API call needed):
```typescript
const thisMonth = reports.filter(r => r.date.startsWith(currentYearMonth)).length;
const thisWeek  = reports.filter(r => isThisWeek(parseISO(r.date))).length;
const onTrack   = reports.filter(r => r.formattedReport.includes("On track")).length;
```

---

## Page 6: Template Picker (`/template`)

**File:** `src/pages/TemplatePicker.tsx`

### Layout

```
"Document Templates"
"Choose how your daily report looks when downloaded as PDF"

┌────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│                │  │                │  │                │  │                │
│  [CLASSIC]     │  │ [PROFESSIONAL] │  │   [MODERN]     │  │  [CORPORATE]   │
│  Preview card  │  │  Preview card  │  │  Preview card  │  │  Preview card  │
│                │  │                │  │                │  │                │
│  ✓ Selected    │  │                │  │                │  │                │
└────────────────┘  └────────────────┘  └────────────────┘  └────────────────┘
            [Apply Template]  (orange button, disabled until selection changes)
```

### Template Preview Cards

Each card is a miniature visual preview of the template (a styled `<div>`, NOT a real PDF). Shows:
- Template name as label
- A small mock layout in the correct visual style
- Company logo position indicator (a small colored rectangle placeholder)
- Border: `border-2 border-transparent` by default, `border-aws-orange` when selected
- Selected checkmark: `<Badge className="bg-aws-orange text-aws-navy">✓ Active</Badge>`

On clicking a card: highlight it. On "Apply Template": call `PATCH /api/profile` to update `defaultTemplate` field, update Zustand `setSelectedTemplate()`, show success toast.

### Four Template Descriptions

**Classic:**
- White background, black text
- Logo top-left, company name top-right in navy
- Title "Daily Report" centered, hr divider below
- Sections in regular text, bullet points

**Professional:**
- Dark navy header block (full width)
- Logo and employee name in header (white text)
- Orange section headers
- Clean sans-serif body

**Modern:**
- Left orange vertical bar (6px)
- Two-column header: logo + company info left, employee details right
- Section headers bold, all-caps, small size
- Body in light gray card background

**Corporate:**
- Full letterhead: top bar (navy) + bottom bar (navy)
- Centered logo at top
- "DAILY WORK REPORT" subtitle, company name below
- Formal memo layout with FROM/DATE/DEPARTMENT fields

---

## Page 7: Generator (`/generator`)

**File:** `src/pages/Generator.tsx`
**Major update from v1:** Employee info pre-filled from profile; output includes template preview and PDF download.

### Layout (2 columns, desktop)

```
┌──────────────────────────┬──────────────────────────────────────────┐
│  INPUT FORM              │  GENERATED REPORT OUTPUT                 │
│                          │                                          │
│  [Report Date]           │  [Template preview with branding]        │
│  (auto: today)           │  [Company logo]  [Company name]          │
│                          │  [Joshua Fotseu · Engineering]           │
│  What did you do today?* │  [Date: July 14, 2026]                   │
│  [large textarea]        │  ─────────────────────────────────       │
│                          │  TASKS COMPLETED TODAY:                  │
│  Plans for tomorrow?     │  • ...                                   │
│  [textarea, optional]    │  PLANNED FOR TOMORROW:                   │
│                          │  • ...                                   │
│  Challenges?             │  CHALLENGES & BLOCKERS:                  │
│  [textarea, optional]    │  None reported.                          │
│                          │  OVERALL STATUS:                         │
│  [Generate Report →]     │  On track...                             │
│                          │  ─────────────────────────────────       │
│                          │  [↓ Download PDF]  [Copy]  [Save]  [↺]  │
└──────────────────────────┴──────────────────────────────────────────┘
```

### Key Changes from v1

- **No name/department fields** — pre-filled silently from `userProfile` in Zustand
- **Template preview** — the output card renders the report in the user's selected template style (a styled HTML preview, not the actual PDF renderer)
- **Download PDF button** — triggers `@react-pdf/renderer` to generate and download the PDF
- **Employee info in output** — company logo, company name, employee name, department, and date appear at the top of the output card (and in the PDF)

### PDF Download Function

```typescript
import { pdf } from "@react-pdf/renderer";
import { ClassicTemplate } from "../components/templates/ClassicTemplate"; // or others

const handleDownload = async () => {
  const doc = getTemplateComponent(selectedTemplate, {
    logoUrl: userProfile.logoUrl,
    companyName: userProfile.companyName,
    employeeName: userProfile.fullName,
    department: userProfile.department,
    date: formValues.date,
    reportContent: generatedReport,
  });

  const blob = await pdf(doc).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `daily-report-${formValues.date}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
```

---

## Page 8: History (`/history`)

**File:** `src/pages/History.tsx`
**Update from v1:** Reports are per authenticated user (not name-based); each row has a Download PDF button.

### Layout

```
"Report History"
"All your saved daily reports — most recent first"

[Search by date]  [Filter: This week / This month / All]

┌──────────────┬──────────────────────────────┬──────────────────┐
│ Date         │ Tasks Preview                │ Actions          │
├──────────────┼──────────────────────────────┼──────────────────┤
│ Jul 14, 2026 │ Fixed auth bug, wrote...     │ [👁] [↓] [🗑]    │
│ Jul 13, 2026 │ Deployed CDK infrastructure  │ [👁] [↓] [🗑]    │
└──────────────┴──────────────────────────────┴──────────────────┘
```

Actions:
- `👁` (Eye icon) — view full report in Dialog
- `↓` (Download icon) — download as PDF in current default template
- `🗑` (Trash icon) — delete with confirmation Dialog

---

## Page 9: Profile (`/profile`)

**File:** `src/pages/Profile.tsx`

### Layout

```
"Your Profile"
"Manage your account and company branding"

┌──────────────────────────────────────────────┐
│  [Company logo, 96×96, rounded-lg]           │
│  [Change logo button]                        │
│                                              │
│  Full name: [Input]                          │
│  Email: [Input, disabled — managed by        │
│          Cognito, read-only]                 │
│  Phone: [Input]                              │
│  Company name: [Input]                       │
│  Department: [Input]                         │
│                                              │
│  Default template:                           │
│  [Select: Classic / Professional / Modern /  │
│           Corporate]                         │
│                                              │
│  [Save Changes]  (orange)                    │
└──────────────────────────────────────────────┘
```

**shadcn Components:** `Form`, `Input`, `Select`, `Button`, `Avatar`, `Separator`, `Card`

On save: `POST /api/profile` with updated fields. If logo changed: `POST /api/upload-url` → direct PUT to S3 → update `logoKey` in profile. Success toast: "Profile updated."

---

## PDF Template Components (`src/components/templates/`)

All templates use `@react-pdf/renderer`. Each is a React component that takes `TemplateProps` and returns a `<Document>`.

```typescript
// src/types/template.ts
interface TemplateProps {
  logoUrl: string | null;
  companyName: string;
  employeeName: string;
  department: string;
  date: string;
  reportContent: string;  // Raw formatted report text from Bedrock
}
```

### Template 1: Classic (`ClassicTemplate.tsx`)

```tsx
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page:       { padding: 48, fontFamily: "Helvetica" },
  header:     { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  logo:       { width: 64, height: 64, objectFit: "contain" },
  companyName:{ fontSize: 18, fontWeight: "bold", color: "#252F3E" },
  title:      { fontSize: 22, textAlign: "center", color: "#252F3E", marginBottom: 8 },
  divider:    { borderBottom: "1pt solid #D5D8DC", marginBottom: 16 },
  empInfo:    { fontSize: 10, color: "#7F8C9A", textAlign: "center", marginBottom: 24 },
  section:    { marginBottom: 16 },
  sectionHdr: { fontSize: 11, fontWeight: "bold", color: "#333E48", marginBottom: 6,
                textTransform: "uppercase", letterSpacing: 1 },
  body:       { fontSize: 10, color: "#333E48", lineHeight: 1.6 },
});

export const ClassicTemplate = (props: TemplateProps) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        {props.logoUrl && <Image src={props.logoUrl} style={styles.logo} />}
        <Text style={styles.companyName}>{props.companyName}</Text>
      </View>
      <Text style={styles.title}>Daily Report</Text>
      <View style={styles.divider} />
      <Text style={styles.empInfo}>
        {props.employeeName} · {props.department} · {props.date}
      </Text>
      {/* Parse reportContent into sections and render each */}
      <ReportSections content={props.reportContent} styles={styles} />
    </Page>
  </Document>
);
```

### Template 2: Professional (`ProfessionalTemplate.tsx`)

```tsx
const styles = StyleSheet.create({
  header:     { backgroundColor: "#252F3E", padding: 24, marginBottom: 24 },
  headerText: { color: "#FFFFFF", fontSize: 14, fontWeight: "bold" },
  headerSub:  { color: "#D5D8DC", fontSize: 10, marginTop: 4 },
  sectionHdr: { fontSize: 11, color: "#FF9900", fontWeight: "bold",
                textTransform: "uppercase", marginBottom: 6, marginTop: 14 },
  // ... rest in navy/orange scheme
});
```

### Template 3: Modern (`ModernTemplate.tsx`)

```tsx
// Left orange accent bar using absolute positioning
const styles = StyleSheet.create({
  accentBar:  { position: "absolute", left: 0, top: 0, bottom: 0, width: 6,
                backgroundColor: "#FF9900" },
  twoColHdr:  { flexDirection: "row", marginBottom: 24, paddingLeft: 24 },
  leftCol:    { width: "40%", paddingRight: 16 },
  rightCol:   { width: "60%" },
  sectionHdr: { fontSize: 9, fontWeight: "bold", textTransform: "uppercase",
                letterSpacing: 1.5, color: "#FF9900", marginBottom: 4 },
  // ...
});
```

### Template 4: Corporate (`CorporateTemplate.tsx`)

```tsx
const styles = StyleSheet.create({
  topBar:     { backgroundColor: "#252F3E", height: 12 },
  bottomBar:  { backgroundColor: "#252F3E", height: 12, position: "absolute",
                bottom: 0, left: 0, right: 0 },
  logoCenter: { alignItems: "center", marginVertical: 20 },
  reportTitle:{ fontSize: 14, fontWeight: "bold", textAlign: "center",
                color: "#252F3E", textTransform: "uppercase", letterSpacing: 2 },
  memoBlock:  { border: "1pt solid #D5D8DC", padding: 12, marginBottom: 20,
                fontSize: 10 },
  // FROM/DATE/DEPT memo fields
});
```

### Content Parser (`src/lib/parseReport.ts`)

Parses the raw Bedrock output into sections for the PDF templates:
```typescript
export function parseReportSections(content: string) {
  const sections = ["TASKS COMPLETED TODAY", "PLANNED FOR TOMORROW",
                    "CHALLENGES & BLOCKERS", "OVERALL STATUS"];
  // Split on section headers, return { header, body }[]
  return sections.map(header => {
    const regex = new RegExp(`${header}:[\\s\\S]*?(?=${sections.join("|")}|$)`);
    const match = content.match(regex);
    return { header, body: match ? match[0].replace(`${header}:`, "").trim() : "" };
  });
}
```

---

## Updated Environment Variables

```bash
# frontend/.env.local
VITE_API_URL=https://<id>.execute-api.us-east-1.amazonaws.com
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_LOGOS_BUCKET=daily-report-logos-396531908855
VITE_AWS_REGION=us-east-1

# frontend/.env.example (safe to commit)
VITE_API_URL=https://your-api-gateway-url
VITE_COGNITO_USER_POOL_ID=us-east-1_YourPoolId
VITE_COGNITO_CLIENT_ID=YourCognitoClientId
VITE_LOGOS_BUCKET=your-logos-bucket-name
VITE_AWS_REGION=us-east-1
```

Update `src/env.d.ts`:
```typescript
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_COGNITO_USER_POOL_ID: string;
  readonly VITE_COGNITO_CLIENT_ID: string;
  readonly VITE_LOGOS_BUCKET: string;
  readonly VITE_AWS_REGION: string;
}
```

---

## Updated Directory Structure

```
frontend/src/
├── api/
│   ├── client.ts          # Axios instance with JWT interceptor
│   └── reports.ts         # API calls (generate, save, history, profile, uploadUrl)
├── components/
│   ├── layout/
│   │   ├── Navbar.tsx             # Public navbar (home page)
│   │   ├── AuthenticatedLayout.tsx # Sidebar + topbar for auth pages
│   │   └── Footer.tsx
│   ├── report/
│   │   ├── ReportForm.tsx
│   │   ├── ReportOutput.tsx       # Template-aware output display
│   │   └── ReportCard.tsx
│   ├── templates/
│   │   ├── ClassicTemplate.tsx    # @react-pdf/renderer components
│   │   ├── ProfessionalTemplate.tsx
│   │   ├── ModernTemplate.tsx
│   │   ├── CorporateTemplate.tsx
│   │   └── index.ts               # getTemplateComponent() selector
│   └── shared/
│       ├── CopyButton.tsx
│       ├── EmptyState.tsx
│       ├── ProtectedRoute.tsx     # Redirects to /login if not authed
│       └── PublicRoute.tsx        # Redirects to /dashboard if authed
├── hooks/
│   ├── useAuth.ts                 # Cognito signUp/signIn/signOut wrappers
│   ├── useGenerateReport.ts
│   └── useReportHistory.ts
├── lib/
│   ├── amplify.ts                 # Amplify.configure()
│   ├── utils.ts                   # cn() helper
│   └── parseReport.ts             # Parse Bedrock output into sections
├── pages/
│   ├── Home.tsx                   # Single-page anchor navigation
│   ├── Register.tsx
│   ├── VerifyEmail.tsx
│   ├── Login.tsx
│   ├── Dashboard.tsx
│   ├── Generator.tsx
│   ├── TemplatePicker.tsx
│   ├── History.tsx
│   └── Profile.tsx
├── store/
│   └── useUIStore.ts
├── types/
│   ├── report.ts
│   ├── template.ts                # TemplateProps interface
│   └── user.ts                    # UserProfile interface
├── App.tsx
├── main.tsx
└── env.d.ts
```