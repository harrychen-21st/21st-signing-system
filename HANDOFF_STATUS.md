# Handoff Status

## Current Deployment
- GitHub Pages URL: `https://harrychen-21st.github.io/21st-signing-system/`
- Apps Script Web App: `https://script.google.com/macros/s/AKfycbxPxIPLrvil9a4x6YCPlML1gvrvxHzBLyCkGMRkU3YhVa8tYsiiErqLvUdNom073_C_ag/exec`
- Current branch: `main`
- Latest GitHub Pages commit already pushed: `ad86029`
- Local unpushed change exists: `apps-script-latest.js` updated with `upsertUsers_()` for test-role provisioning

## What Is Already Done
- GitHub Pages workflow is in `.github/workflows/deploy-pages.yml`
- Vite `base` path supports GitHub Pages deployment
- Shared API client exists at `src/lib/api.ts`
- Submit form, approver dashboard, track dashboard, and admin dashboard have all been adapted further for Apps Script direct calls
- Build version marker is shown in the UI as `build: <hash>` to verify deployed bundle freshness
- Work history is recorded in `WORKLOG.md`
- Primary login/session UI is implemented
- Role-based tab hiding is implemented
- Notice board rendering is implemented on submit page
- Admin notice-board management UI exists locally and partially on live site depending on deployed commit

## Current Known State
- GitHub Pages deployment itself is working
- The live site can render UI
- User lookup works on the live site
- Submit form type loading and submit flow have basic live validation, but AML-specific end-to-end flow still needs full verification
- The live site currently lags behind the latest local Apps Script support changes if `apps-script-latest.js` has not been redeployed
- Track dashboard and approver dashboard now call real data paths, but require latest Apps Script actions (`getMyTickets`, `getPendingTickets`) to be deployed
- Admin dashboard is now split conceptually into A/B/C modes locally; C mode for multi-notice management still needs deployment validation

## Known Missing Product Features
- Multi-notice board with per-notice publish time is implemented locally but not yet verified on the live site
- AML / related-party approval flow has not yet been fully verified end-to-end on the live site
- Test-user upsert in `setupRealData()` is implemented locally but not yet deployed to Apps Script

## Immediate Next Checks On Another Machine
1. Pull latest `main`
2. Open `WORKLOG.md`
3. Open `HANDOFF_STATUS.md`
4. Check `git status` immediately after pull: if local change is missing, confirm whether `apps-script-latest.js` upsert logic was committed yet
5. Check GitHub Actions Pages deployment result
6. Open the live site and confirm the visible `build: <hash>` value matches the latest pushed commit
7. Redeploy Google Apps Script using the current `apps-script-latest.js`
8. Run `setupRealData()` again after redeploy
9. Re-test:
   - login
   - role-based tab visibility
   - notice board rendering
   - submit form
   - my tickets query
   - pending tickets query
   - admin notice-board save
   - AML / related-party flow end-to-end

## AML Test Accounts
- Applicant: `test@company.com`
- Manager / GM: `boss@company.com`
- AML reviewer: `aml@company.com`
- Admin: `admin@company.com`
- Finance / admin-gm: `finance@company.com`

## AML End-to-End Test Flow
1. Update and redeploy `apps-script-latest.js`
2. Run `setupRealData()`
3. Confirm `Users` contains the five test accounts above
4. Login as `test@company.com`
5. Submit an `AP` form with `external_collab = true`
6. Login as `boss@company.com` and approve the ticket in 主管簽核區
7. Login as `aml@company.com`
8. Open the same ticket in 主管簽核區
9. Verify the modal shows:
   - AML 盡職調查結果
   - AML 備註
   - 關係人交易調查結果
   - 關係人交易備註
10. Choose disallowed values to verify backend blocks approval:
   - `AML = 不正常`, or
   - `RP = 關係人交易但未經過董事會同意`
11. Choose allowed values to verify approval can continue:
   - `AML = 正常`
   - `RP = 非關係人交易` or `關係人交易且已經過董事會同意`

## Most Important Debug Principle
If the live site still shows old `/api/...` behavior, first verify the `build: <hash>` shown in the UI before debugging Apps Script.
