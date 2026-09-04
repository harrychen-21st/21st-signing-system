# Architecture

## High-level architecture

```mermaid
flowchart LR
  User[Employee browser] --> React[React SPA]
  React --> Express[Express BFF API]
  Express --> GAS[Google Apps Script Web App]
  GAS --> Sheets[(Google Sheets)]
  GAS --> Mail[Gmail / MailApp]
  Express --> GCIS[GCIS company lookup API]
  Express --> Gemini[Gemini API for admin form modeling]
```

The application is a React single-page app backed by an Express BFF. Express handles JWT auth, route authorization, response shaping, local development fallback behavior, and calls to Google Apps Script. Apps Script is the persistent data adapter and operational integration layer for Google Sheets and email.

## Client to Express to Apps Script to Google Sheets flow

```mermaid
sequenceDiagram
  participant Client as React client
  participant API as Express BFF
  participant GAS as Apps Script Web App
  participant Sheets as Google Sheets

  Client->>API: authFetch('/api/...') with Bearer JWT
  API->>API: verify JWT
  API->>GAS: GET/POST action payload
  GAS->>Sheets: read/write rows
  Sheets-->>GAS: values
  GAS-->>API: JSON result
  API-->>Client: normalized JSON
```

If `GOOGLE_APPS_SCRIPT_URL` is missing, many BFF endpoints return mock data. This is useful for development but must not be used as production truth.

Vercel executes JavaScript functions at runtime, so `api/app.js` is generated from `server/app.ts` by `npm run sync:api` before lint/build and is kept in the repository as the runtime companion.

## Authentication flow

```mermaid
sequenceDiagram
  participant Client as LoginForm
  participant API as POST /api/auth/login
  participant GAS as Apps Script getUser
  participant Users as Users sheet

  Client->>API: email
  API->>GAS: ?action=getUser&email=...
  GAS->>Users: find row by Email
  Users-->>GAS: user row
  GAS-->>API: user fields and roles
  API->>API: sign JWT, 7 day expiry
  API-->>Client: token and user
  Client->>Client: store jwt and user in localStorage
```

Every protected request uses `authFetch`, which attaches the stored JWT. A 401 clears the JWT and emits `auth-expired`.

## Form submission flow

```mermaid
sequenceDiagram
  participant Client as SubmitForm
  participant API as /api/submit-approval
  participant GAS as submitApplication
  participant Tickets as Tickets sheet
  participant Relations as TicketRelations sheet
  participant Attachments as AttachmentChecks sheet
  participant AML as AML sheet
  participant Audit as AuditLogs sheet
  participant Mail as Gmail

  Client->>API: applicant, form type, subject, amount, formData
  API->>API: check attachment links and keep warnings
  API->>GAS: action submitApplication
  GAS->>GAS: generateApplicationNumber_
  GAS->>AML: append AML/related-party row when tax ID exists
  GAS->>Tickets: append ticket row
  GAS->>Relations: append source -> generated ticket links from related_ticket
  GAS->>Attachments: append attachment check results
  GAS->>Audit: append Submitted log
  GAS->>Mail: email applicant
  GAS-->>API: applicationNumber, amlStatus
  API-->>Client: generatedIds, applicationNumber, amlStatus, attachmentWarnings
```

Production submission currently uses `submitApplication`, not the older `submitTickets` flow.

## Backoffice completion flow

```mermaid
flowchart TD
  A[Ticket created] --> B[Current product path]
  B --> C[Backoffice views /api/backoffice/tickets]
  C --> D[Authorized staff manually handle request]
  D --> E[POST /api/tickets/:id/complete]
  E --> F[Apps Script sets Completed and writes AuditLogs]
```

The visible UI is currently backoffice completion oriented. Legacy per-stage approval APIs were removed from the Express BFF; `apps-script-latest.js` still contains some historical actions and should be reconciled after confirming the deployed Apps Script source.

## Ticket relation and investigation sync flow

```mermaid
flowchart TD
  A[New ticket has related_ticket] --> B[Create TicketRelations source -> target]
  B --> C[Applicant / backoffice query]
  C --> D[Return linked ticket basic info only]
  E[AML sheet updated manually] --> F[syncAmlRpResults]
  F --> G[Write AML_Result and RP_Result to Tickets]
  G --> H[Applicant and backoffice display latest status]
```

`WorkflowRules` is now treated as a backoffice processing-rule table. If an old per-stage workflow header is found, Apps Script archives it to a `WorkflowRules_Legacy_*` sheet and resets `WorkflowRules` to the new processing-rule headers.

## Admin configuration flow

```mermaid
flowchart LR
  Admin[ROLE:ADMIN user] --> UI[AdminDashboard]
  UI --> Types[FormTypes APIs]
  UI --> Defs[FormDefinitions APIs]
  UI --> Rules[WorkflowRules APIs for processing-rule hints]
  UI --> Notice[SystemSettings NoticeBoard]
  UI --> AI[Gemini form model endpoint]
  Types --> GAS[Apps Script]
  Defs --> GAS
  Rules --> GAS
  Notice --> GAS
  GAS --> Sheets[(Google Sheets)]
```

Admin writes are allowed only through UI gating and some BFF checks. Some write endpoints should still be reviewed for consistent server-side `ROLE:ADMIN` enforcement.

## Company lookup flow

```mermaid
flowchart TD
  A[User enters 8 digit tax ID] --> B[SubmitForm calls /api/company/:taxId]
  B --> C[JWT middleware]
  C --> D[GCIS open data API]
  D -->|valid company| E[Return official company name and owner]
  D -->|empty/error| F[Local dictionary]
  F -->|known tax ID| G[Return dictionary company]
  F -->|unknown tax ID| H[Return procedural mock company]
```

The procedural mock fallback is useful for testing but is a production data-quality risk if users treat it as verified company data.
