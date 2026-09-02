# Project Handover

## Current System Status

The app builds and type-checks successfully. It can run locally through `npm run dev` and serves the React app through Express/Vite at `http://localhost:3000`.

The current implemented system is an internal request intake, tracking, AML/related-party investigation notification, backoffice completion, and meeting-room booking system. The Express BFF now exposes the current backoffice completion path and no longer exposes the old online approve/reject queue.

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
- Rejected-ticket resubmission path with owner/admin checks.
- Backoffice ticket list and manual completion.
- Notice board management through `SystemSettings`.
- Admin form/spec management and Gemini-assisted form modeling.
- Meeting-room list, booking, cancellation, admin room management, and reminder functions in Apps Script.
- Vercel deployment adapter and rewrite configuration. `api/index.ts` imports generated `api/app.js`, which is produced from `api/app.ts` by `npm run sync:api` during lint/build.
- GitHub Actions CI build on push/PR to `main`.

## Known Risks

### Critical

- Apps Script Web App actions are not independently authenticated by the BFF JWT. If the script URL is public or leaked, GAS write actions must rely on Apps Script deployment access controls or a future shared-secret check.

### High

- Development fallback behavior can return mock data when external sources are missing. Procedural company generation is now disabled in `NODE_ENV=production`, but production configuration still needs explicit verification.
- There are two Apps Script files with overlapping but different capabilities. It is UNKNOWN which script is deployed. `apps-script-deploy-clean.js` includes meeting-room and mail retry support that `apps-script-latest.js` does not fully share.
- Current product wording and `ApproverDashboard` use backoffice completion, while `AI_WORK_RECORD.md` and Apps Script legacy actions still describe/implement multi-stage approval. The active business process needs owner confirmation.
- `GET /api/form-definitions` force-overrides local `RD` definition content and always uses local `ConfigJSON` for known forms, even when Sheets has different configuration.
- npm audit reports 11 vulnerabilities, including 7 high severity items across `vite`, `postcss`, `protobufjs`, `ws`, `nanoid`, `extract-zip`, and transitive dependencies.
- CI now runs `npm run lint` before `npm run build`.
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
- Whether Vercel production has `JWT_SECRET`, `GOOGLE_APPS_SCRIPT_URL`, and `GEMINI_API_KEY` configured. Confirmed by Vercel CLI on 2026-09-02; values were hidden.
- Whether legacy Apps Script actions such as `submitTickets`, `updateTicket`, and `resubmitTicket` are still needed by any deployed client.

## Recommended Next Steps

### P0

- Add request authentication directly to Apps Script write actions or restrict Apps Script Web App access.
- Confirm the active Apps Script deployment source and make one script the canonical production script.

### P1

- Decide and document the official business process: multi-stage online approval versus backoffice completion.
- Add tests for auth bypass paths, workflow rule evaluation, ticket submission, resubmission, and backoffice completion.
- Disable procedural company fallback in production or label it clearly as unverified.
- Smoke-test the Vercel production API after deployment. Vercel needs `api/app.js`, so it is generated from `api/app.ts` before lint/build.
- Address high-severity npm audit findings in a separate dependency PR.

### P2

- Consolidate local form definitions, Apps Script setup definitions, and Sheets configuration into one managed source of truth.
- Add schema versioning or migration notes for Google Sheets tabs.
- Replace silent mock fallbacks on production-like routes with explicit configuration errors.
- Add Apps Script deployment SOP and healthcheck validation.

### P3

- Update `README.md` with real setup and operating instructions.
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
