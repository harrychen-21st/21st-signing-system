<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c64215f0-26ea-478b-aa39-26719a7aa2a8

## Project Docs

- Local testing SOP: [LOCAL_TESTING_SOP.md](./LOCAL_TESTING_SOP.md)
- Cloud Run deploy SOP: [CLOUD_RUN_DEPLOY_SOP.md](./CLOUD_RUN_DEPLOY_SOP.md)
- GitHub Pages + Apps Script SOP: [GITHUB_PAGES_APPS_SCRIPT_SOP.md](./GITHUB_PAGES_APPS_SCRIPT_SOP.md)
- Development work log: [WORKLOG.md](./WORKLOG.md)

## GitHub Pages Target

- Production URL: https://harrychen-21st.github.io/21st-signing-system/
- Apps Script Web App: https://script.google.com/macros/s/AKfycbxPxIPLrvil9a4x6YCPlML1gvrvxHzBLyCkGMRkU3YhVa8tYsiiErqLvUdNom073_C_ag/exec

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
