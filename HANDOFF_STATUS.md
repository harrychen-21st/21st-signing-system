# Handoff Status

## Current Deployment
- GitHub Pages URL: `https://harrychen-21st.github.io/21st-signing-system/`
- Apps Script Web App: `https://script.google.com/macros/s/AKfycbxPxIPLrvil9a4x6YCPlML1gvrvxHzBLyCkGMRkU3YhVa8tYsiiErqLvUdNom073_C_ag/exec`
- Current branch: `main`

## What Is Already Done
- GitHub Pages workflow is in `.github/workflows/deploy-pages.yml`
- Vite `base` path supports GitHub Pages deployment
- Shared API client exists at `src/lib/api.ts`
- Submit form has been partially adapted for Apps Script direct calls
- Build version marker is shown in the UI as `build: <hash>` to verify deployed bundle freshness
- Work history is recorded in `WORKLOG.md`

## Current Known State
- GitHub Pages deployment itself is working
- The live site can render UI
- User lookup works on the live site
- Submit form type loading and submit flow still need live verification after latest deployment
- Approver dashboard is not fully adapted to direct Apps Script mode
- Track dashboard is not fully adapted to direct Apps Script mode
- Admin dashboard is only partially adapted

## Known Missing Product Features
- Single sign-in/session across tabs is not implemented in the current UI
- Role-based tab visibility is not implemented in the current UI
- Bulletin board feature is currently missing

## Immediate Next Checks On Another Machine
1. Pull latest `main`
2. Open `WORKLOG.md`
3. Open `HANDOFF_STATUS.md`
4. Check GitHub Actions Pages deployment result
5. Open the live site and confirm the visible `build: <hash>` value matches the latest commit
6. Re-test:
   - user lookup
   - form type loading
   - form submit
   - admin data loading

## Most Important Debug Principle
If the live site still shows old `/api/...` behavior, first verify the `build: <hash>` shown in the UI before debugging Apps Script.
