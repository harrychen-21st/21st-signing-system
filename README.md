# 21CD 內部申請管理系統

React/Vite 前端搭配 Express BFF、Google Apps Script 與 Google Sheets 的內部申請管理系統。

## Current Scope

- 申請表單填寫與自動產生單號
- 個人申請查詢與處理紀錄
- 後台查詢、篩選、完成結案與 Excel 稽核包匯出
- 單號關聯勾稽：`TicketRelations`
- AML / 關係人調查資料同步與結果回寫，支援後台手動同步
- 附件連結檢查警示：`AttachmentChecks`
- 會議室預約與提醒
- 系統公告管理

## Run Locally

1. Install dependencies:
   `npm install`
2. Create `.env.local` from `.env.example` and set:
   - `JWT_SECRET`
   - `GOOGLE_APPS_SCRIPT_URL`
   - `GEMINI_API_KEY` if using AI form modeling
3. Start the app:
   `npm run dev`

## Build And Verify

- Type-check and sync Vercel runtime artifact:
  `npm run lint`
- Production build:
  `npm run build`

`api/app.js` is generated from `server/app.ts` and must be kept in sync for Vercel.

## Apps Script

`apps-script-deploy-clean.js` is the current canonical Apps Script source.

After updating Apps Script, run:

- `setupRealData()` to create or update required sheets and headers.
- `setupMailRetryTrigger()` to install the mail retry processor if needed.
- `setupAmlRpSyncTrigger()` to sync AML/RP results every 5 minutes if desired.

The live Apps Script deployment should include `getTicketBundle`; otherwise the app falls back to separate sheet reads and ticket list loading will be slower.
