# Project Handover

## Current System Status

The app builds and type-checks successfully. It can run locally through `npm run dev` and serves the React app through Express/Vite at `http://localhost:3000`.

The current implemented system is an internal request intake, tracking, AML/related-party investigation notification, backoffice completion, and meeting-room booking system. The codebase still contains older dynamic multi-stage approval logic, but the visible `ApproverDashboard` now uses `/api/backoffice/tickets` and `/api/tickets/:ticketId/complete` rather than the older approve/reject queue.

## Existing Features

- Email-based login backed by the `Users` sheet when Apps Script is configured.
- JWT-protected BFF APIs.
- Dynamic form type and form definition loading.
- Default `AP`, `RD`, and `CS` form definitions in code.
- External-company fields and tax ID company lookup.
- Submission to Apps Script `submitApplication`.
- Application number generation in Apps Script.
- AML/related-party row synchronization and investigation email notification.
- Applicant request tracking with audit log display.
- Rejected-ticket resubmission path through legacy APIs.
- Backoffice ticket list and manual completion.
- Notice board management through `SystemSettings`.
- Admin form/spec management and Gemini-assisted form modeling.
- Meeting-room list, booking, cancellation, admin room management, and reminder functions in Apps Script.
- Vercel deployment adapter and rewrite configuration.
- GitHub Actions CI build on push/PR to `main`.

## Known Risks

### Critical

- `JWT_SECRET` falls back to a hardcoded value in `api/app.ts`. If production lacks a real secret, tokens can be forged.
- Several identity-sensitive endpoints accept email fields from route/body without consistently checking they match `req.user.email`. Examples include applicant history, legacy pending lookup, ticket submission payload, and resubmission payload. This creates spoofing or unauthorized data access risk if routes are exposed.
- Legacy `POST /api/tickets/:ticketId/action` does not verify that the authenticated user is the current approver before approving/rejecting. It trusts `approverEmail` from the request body.
- `POST /api/settings`, `POST /api/form-types`, `POST /api/form-definitions/:formId`, and `POST /api/rules/:formType` are protected by JWT but are not consistently server-side admin-only. UI hides them from non-admins, but API authorization should be enforced server-side.

### High

- Production fallback behavior can return mock data or procedural company data when external sources are missing or empty. This is dangerous for production if configuration is absent or an upstream API fails.
- There are two Apps Script files with overlapping but different capabilities. It is UNKNOWN which script is deployed. `apps-script-deploy-clean.js` includes meeting-room and mail retry support that `apps-script-latest.js` does not fully share.
- `api/app.js` is a compiled copy committed beside `api/app.ts`. It can drift from source and create deployment ambiguity.
- Current product wording and `ApproverDashboard` use backoffice completion, while `AI_WORK_RECORD.md` and legacy APIs still describe/implement multi-stage approval. The active business process needs owner confirmation.
- `GET /api/form-definitions` force-overrides local `RD` definition content and always uses local `ConfigJSON` for known forms, even when Sheets has different configuration.
- npm audit reports 11 vulnerabilities, including 7 high severity items across `vite`, `postcss`, `protobufjs`, `ws`, `nanoid`, `extract-zip`, and transitive dependencies.
- The CI workflow runs `npm run build` but not `npm run lint`, so TypeScript checking can pass locally but is not enforced in PR CI.
- Apps Script `saveRules` deletes existing rules for a form and then inserts replacements. With bad input or partial failure, a form's workflow rules can be lost.

## Technical Debt

- `README.md` is still the generic AI Studio template and does not document the real system.
- `AI_WORK_RECORD.md` is useful but mixes old approval concepts with newer backoffice flow.
- Business logic is duplicated across local BFF defaults, Apps Script setup data, and Google Sheets.
- Some routes catch Apps Script errors and return mock tickets, which can hide production connectivity failures.
- No automated tests cover workflow evaluation, authorization, Apps Script contracts, or meeting-room conflict handling.
- `test_company_api.js` is an integration helper that starts a dev server; it is not part of npm scripts or CI.
- Frontend route visibility and backend route authorization are not aligned everywhere.
- Google Sheets schema changes have no migration/version mechanism.
- Apps Script deployment process is manual and not represented in CI.

## Environment Requirements

- Node.js 20 or compatible modern Node runtime.
- `JWT_SECRET` for non-local deployments.
- `GOOGLE_APPS_SCRIPT_URL` pointing to the deployed Apps Script Web App.
- Google Apps Script project with access to the target spreadsheet.
- Script property `SPREADSHEET_ID` when Apps Script is not bound to the spreadsheet.
- Google Sheets tabs with expected headers.
- Gmail/MailApp or GmailApp authorization for notification email.
- `GEMINI_API_KEY` for admin AI form modeling.
- `APP_URL` is documented but not currently required by code paths reviewed.

## Unknowns

- Which Apps Script file is currently deployed in production: `apps-script-latest.js` or `apps-script-deploy-clean.js`.
- Whether the production process should be true multi-stage online approval or request intake plus offline/backoffice completion.
- The real production Google Sheet headers and whether they include extra columns not represented in code.
- The real AML spreadsheet ID and whether the hardcoded default ID is production, staging, or historical.
- Whether `ROLE:ADMIN_HEAD`, `ROLE:ADMIN_DIRECTOR`, `ROLE:FINANCE`, `ROLE:RISK`, `ROLE:DEPT_HEAD`, and `ROLE:GM` should all be allowed to see every backoffice ticket.
- Whether meeting-room functions are deployed and actively used.
- Whether procedural company fallback should be disabled in production.
- Whether Vercel production has `JWT_SECRET`, `GOOGLE_APPS_SCRIPT_URL`, and `GEMINI_API_KEY` configured.
- Whether `api/app.js` is intentionally required by Vercel or can be removed after deployment validation.

## Recommended Next Steps

### P0

- Require `JWT_SECRET` in production and remove or block hardcoded fallback for deployed environments.
- Enforce server-side authorization for all admin writes.
- Bind identity-sensitive API requests to `req.user.email` and roles; do not trust body/path email for ownership or approver identity.
- Confirm the active Apps Script deployment source and make one script the canonical production script.

### P1

- Decide and document the official business process: multi-stage online approval versus backoffice completion.
- Add tests for auth bypass paths, workflow rule evaluation, ticket submission, resubmission, and backoffice completion.
- Disable procedural company fallback in production or label it clearly as unverified.
- Add `npm run lint` to GitHub Actions.
- Address high-severity npm audit findings in a separate dependency PR.

### P2

- Consolidate local form definitions, Apps Script setup definitions, and Sheets configuration into one managed source of truth.
- Add schema versioning or migration notes for Google Sheets tabs.
- Replace silent mock fallbacks on production-like routes with explicit configuration errors.
- Add Apps Script deployment SOP and healthcheck validation.

### P3

- Update `README.md` with real setup and operating instructions.
- Decide whether to keep or remove `api/app.js`.
- Add user-facing admin documentation for form/rule setup.
- Add operational dashboards or logs for mail retry and AML notification failures.

## Validation Results

- `npm install`: passed. Reported 11 npm audit vulnerabilities: 3 low, 1 moderate, 7 high.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run dev`: passed. Server started on `http://localhost:3000`.
- Local page check: `GET /` returned 200.
- Protected API check: unauthenticated `GET /api/form-types` returned 401.

## Deployment Impact

This handover PR adds documentation only. It does not change application runtime behavior, UI, API behavior, Google Sheets schema, Apps Script behavior, or production deployment configuration.
