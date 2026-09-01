# Project Overview

This repository is a production-oriented internal request and signing/support system for 21CD. The current product flow lets employees log in with a company email, submit internal request forms, print or track submitted applications, route external-company cases into AML/related-party investigation tracking, and let authorized backoffice users complete requests after manual handling. It also includes meeting-room booking and meeting-room administration.

This is an existing system. Future Codex sessions must preserve current behavior unless a task explicitly requests a change.

# Architecture

- React 19 + Vite + TypeScript renders the single-page app under `src/`.
- `server.ts` starts an Express app from `api/app.ts`. In development it mounts Vite middleware; in production it serves `dist`.
- `api/index.ts` adapts the Express app for Vercel serverless routing. `vercel.json` rewrites `/api/:path*` to this handler.
- Google Apps Script is the database adapter and workflow-side integration layer. It reads and writes Google Sheets and sends notification email.
- Google Sheets is the persistent datastore for users, tickets, form definitions, workflow rules, system settings, AML tracking, meeting rooms, bookings, audit logs, and mail retry state.

# Source of Truth

- React owns UI state, local JWT storage, form rendering, client-side required fields, print layouts, and meeting-room client validation.
- `api/app.ts` owns JWT verification, route authorization, request normalization, local fallback data, company lookup fallback, and BFF contracts to Apps Script.
- Apps Script owns actual Google Sheets writes, application number generation in production, AML sheet synchronization, email notifications, meeting-room conflict checks, and audit log writes.
- Google Sheets owns operational data and admin-edited configuration. The known sheets are `Users`, `Tickets`, `FormTypes`, `WorkflowRules`, `AuditLogs`, `FormDefinitions`, `SystemSettings`, `MeetingRooms`, `MeetingBookings`, and in `apps-script-deploy-clean.js`, `MailRetryQueue`.
- `api/app.ts` includes local fallback form definitions for `AP`, `RD`, and `CS`. For these forms it can override fetched `ConfigJSON`; this means code and Sheets are both active sources and must be reconciled carefully before schema changes.

# Important Files

- `README.md`: currently generic AI Studio run instructions; not authoritative for business behavior.
- `AI_WORK_RECORD.md`: historical handover and implementation notes; useful but must be verified against code.
- `package.json`: npm scripts and dependencies. `npm run lint` is TypeScript checking via `tsc --noEmit`.
- `.env.example`: environment variable names only. Do not commit `.env` or `.env.local`.
- `server.ts`: local/production Express bootstrap.
- `api/app.ts`: main BFF/API implementation.
- `api/index.ts`: Vercel serverless adapter.
- `api/app.js`: compiled JavaScript copy of `api/app.ts`; treat as a deployment/maintenance risk because it can drift.
- `apps-script-latest.js`: Apps Script implementation with request submission, AML tracking, legacy workflow actions, and setup helpers.
- `apps-script-deploy-clean.js`: cleaner Apps Script implementation with meeting-room APIs and mail retry helpers; confirm whether this is the deployed production script before changing GAS.
- `src/App.tsx`: top-level tab routing and role-based UI visibility.
- `src/LoginForm.tsx`: email-only login form.
- `src/authFetch.ts`: attaches the JWT from localStorage and emits `auth-expired` on 401.
- `src/SubmitForm.tsx`: dynamic form rendering, external company fields, company lookup, submission, and print layout.
- `src/TrackDashboard.tsx`: applicant ticket history, audit log loading, printing, and rejected-ticket resubmission UI.
- `src/ApproverDashboard.tsx`: current backoffice ticket list and manual completion UI.
- `src/AdminDashboard.tsx`: form type/spec management, AI form model generation, and notice board management.
- `src/MeetingRoomBooking.tsx`: meeting-room calendar, booking creation, cancellation, and Google Calendar link generation.
- `src/MeetingRoomAdmin.tsx`: admin room setup and booking cancellation.
- `.github/workflows/ci.yml`: CI currently runs `npm ci` and `npm run build` on `main` pushes and PRs.

# Business Rules

- Login accepts an email and loads the matching user from `Users` through Apps Script when `GOOGLE_APPS_SCRIPT_URL` is set.
- JWT payload includes `email`, `name`, `dept`, `manager`, and `roles`.
- Admin-only UI is shown when the user has `ROLE:ADMIN`.
- Backoffice UI is shown to `ROLE:ADMIN`, `ROLE:ADMIN_HEAD`, `ROLE:ADMIN_DIRECTOR`, `ROLE:FINANCE`, `ROLE:RISK`, `ROLE:DEPT_HEAD`, or `ROLE:GM`.
- Form types default to `AP`, `RD`, and `CS` if the Apps Script form type source is unavailable or empty.
- External-company fields are injected by `SubmitForm.tsx` even if the stored form definition does not contain them.
- A submitted production ticket is appended to `Tickets` and a `Submitted` row is appended to `AuditLogs`.
- If `external_collab` is `是`, Apps Script writes an AML/related-party record and status may become `Checking`; otherwise status is generally `Submitted`.
- Backoffice completion sets ticket status to `Completed`, clears `CurrentApprover`, writes an audit log, and emails the applicant.
- Meeting-room bookings are limited to 09:00-18:00, 30-minute increments, 30-120 minute duration, and 30 days into the future.

# Workflow Rules

Current user-facing UI is closer to a request intake and backoffice completion system. However, legacy dynamic approval endpoints still exist in `api/app.ts` and `apps-script-latest.js`.

- `MANAGER`: resolves to `Users.ManagerEmail` for the applicant.
- `ROLE`: resolves to the configured `ROLE:*` value in `WorkflowRules.ApproverValue`.
- `SPECIAL:AML_CHECK`: treated as a special approval type in legacy approval action code. Server-side code blocks approval if AML result is abnormal or related-party approval is missing.
- Skip Logic: legacy `evaluateDynamicRules` skips a `MANAGER` stage when the manager email equals the applicant email, and skips a `ROLE` stage when the applicant already has that role.
- `AP` default legacy rules: manager, department head, conditional AML check on `external_collab == 是`, admin VP, GM.
- `RD` default legacy rules: manager, department head, admin VP and GM only when `amount > 5000`.
- `CS` default legacy rules: legal first for `seal_type == 合約便章`, then manager and department head; non-invoice seals continue to admin VP, GM, big seal manager, and small seal manager. `發票章` effectively ends after department head in the legacy evaluator because later rules do not match.

# Data Model

Known Google Sheets columns from Apps Script setup:

- `Users`: `Email`, `Name`, `Department`, `ManagerEmail`, `Roles`.
- `Tickets`: `TicketID`, `CreatedAt`, `ApplicantEmail`, `ApplicantName`, `Department`, `FormType`, `Status`, `CurrentStage`, `SLA_Deadline`, `Subject`, `Amount`, `NeedsAML`, `FormData_JSON`, `CurrentApprover`.
- `FormTypes`: `FormID`, `FormName`.
- `WorkflowRules`: `RuleID`, `FormType`, `Stage`, `ConditionField`, `ConditionOp`, `ConditionVal`, `ApproverType`, `ApproverValue`.
- `AuditLogs`: `TicketID`, `ActionType`, `ApproverID`, `Stage`, `Comment`, `Timestamp`.
- `FormDefinitions`: `FormID`, `FieldsMarkdown`, `LogicMarkdown`, `ConfigJSON`.
- `SystemSettings`: `Key`, `Value`.
- `MeetingRooms`: `RoomID`, `RoomName`, `Location`, `Capacity`, `IsActive`, `SortOrder`, `OpenTime`, `CloseTime`, `CreatedAt`.
- `MeetingBookings`: `BookingID`, `RoomID`, `RoomName`, `BookerEmail`, `BookerName`, `Department`, `Date`, `StartTime`, `EndTime`, `Purpose`, `Status`, `CreatedAt`, `UpdatedAt`, `CancelledAt`, `CancelledBy`, `ReminderSentAt`.
- `MailRetryQueue`: `RetryKey`, `To`, `Subject`, `Body`, `Name`, `Attempts`, `NextAttemptAt`, `Status`, `LastError`, `CreatedAt`, `UpdatedAt`. This appears only in `apps-script-deploy-clean.js`.
- AML sheet columns observed in code: `填表日期`, `表單類型`, `表單編號`, `公司別`, `需求單位`, `商家名稱`, `統一編號`, `負責人姓名`, `通知管理處查詢`, `通知風控查詢`. The actual production spreadsheet and any extra columns are UNKNOWN.

# API Architecture

Primary Express endpoints:

- `POST /api/auth/login`: email login and JWT issue.
- `GET /api/users/:email`: user lookup.
- `GET /api/company/:taxId`: company/tax ID lookup through GCIS with local dictionary and procedural fallback.
- `GET /api/settings/:key`, `POST /api/settings`: system setting read/write.
- `POST /api/ai-form-model`: admin-only Gemini form/rule model generation.
- `GET /api/form-types`, `POST /api/form-types`: form type list/upsert.
- `GET /api/form-definitions`, `POST /api/form-definitions/:formId`: form definition list/upsert.
- `GET /api/rules/:formType`, `POST /api/rules/:formType`: legacy workflow rule list/replace.
- `POST /api/submit-approval`: current form submission BFF. Calls Apps Script `submitApplication`.
- `GET /api/tickets/pending/:email`: legacy approver queue.
- `POST /api/tickets/:ticketId/action`: legacy approve/reject.
- `POST /api/tickets/:ticketId/resubmit`: rejected ticket resubmission.
- `GET /api/tickets/my/:email`: applicant history.
- `GET /api/tickets/:ticketId/logs`: audit log lookup.
- `GET /api/backoffice/tickets`: authorized backoffice ticket list.
- `POST /api/tickets/:ticketId/complete`: manual completion.
- `GET /api/meeting-rooms`, `POST /api/meeting-rooms`: room list/upsert.
- `GET /api/meeting-bookings`, `POST /api/meeting-bookings`, `POST /api/meeting-bookings/:bookingId/cancel`: booking list/create/cancel.

# Authentication

- Login is email-only. When `GOOGLE_APPS_SCRIPT_URL` exists, the email must be present in the `Users` sheet. Without that URL, only local mock users can log in.
- JWTs are signed by `JWT_SECRET` and expire in 7 days.
- `authMiddleware` protects all non-login APIs.
- The default JWT secret is `fallback-secret-key` in `api/app.ts`; production must set `JWT_SECRET`.
- Several endpoints accept email values in path or body and do not consistently verify that those values match `req.user.email`. Treat identity-sensitive changes as high risk.

# Environment Variables

- `JWT_SECRET`: signs and verifies JWTs. Required for any deployed or shared environment.
- `GOOGLE_APPS_SCRIPT_URL`: Apps Script Web App URL used as the production data source.
- `GEMINI_API_KEY`: used by admin AI form generation.
- `APP_URL`: documented for hosted app callbacks/self links, but current code does not rely on it directly.
- `PORT`: optional local/server port for `server.ts`.
- `NODE_ENV`: controls production static serving versus development Vite middleware.

# Development Commands

```bash
npm install
npm run dev
npm run lint
npm run build
```

Optional checks:

```bash
npm audit --audit-level=low
node test_company_api.js
```

# Development Rules

1. Search all affected code before modifying behavior.
2. Do not change only frontend when the backend or Apps Script contract is affected.
3. Do not change only Apps Script when the Express contract is affected.
4. Do not arbitrarily change Google Sheets schema.
5. Before schema changes, check migration and backward compatibility.
6. Do not delete existing behavior unless the task explicitly requests it.
7. Prefer backward compatibility.
8. Approval workflow and request completion are high-risk business logic.
9. Workflow changes must list all affected scenarios.
10. Authentication and authorization changes must be checked for bypass paths.
11. Never commit credentials, API keys, passwords, tokens, or production URLs with secrets.
12. Never let mock or procedural fake company data be used as production truth.
13. Run `npm run lint` and `npm run build` after changes.
14. Run relevant tests when they exist.
15. Every change summary must explain deployment impact.

# Definition of Done

A task is done only when:

- Code is complete.
- Affected paths were checked.
- `npm run lint` passes.
- `npm run build` passes.
- Relevant tests pass or the reason they were not run is stated.
- No secret was added to git.
- Deployment impact is explained.
- Business logic changes are explained.
