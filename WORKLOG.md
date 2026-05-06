# 開發工作日誌

## 用途
這份文件用來記錄每次開發、調整、修正與文件更新。

## 記錄規則
- 每次有實際變更時，新增一筆最新紀錄放在最上方。
- 每筆紀錄至少包含日期、內容、影響檔案、驗證方式。
- 若只是規劃但未實作，不記錄為完成項目。
- 若變更尚未驗證，要明確標示未驗證。

## 紀錄格式
```md
## YYYY-MM-DD

### 變更摘要
- 簡述這次調整內容

### 影響檔案
- `path/to/file`

### 驗證
- 已驗證：說明驗證方式
- 未驗證：說明原因
```

## 2026-05-06

### 變更摘要
- 新增 `src/lib/api.ts`，建立 GitHub Pages / Apps Script 過渡期共用 API client。
- 新增 `.github/workflows/deploy-pages.yml`，建立 GitHub Pages 自動部署工作流骨架。
- 將 `SubmitForm.tsx`、`ApproverDashboard.tsx`、`TrackDashboard.tsx` 的部分 API 呼叫改為經由共用 API client。
- 更新 `README.md`，補上 GitHub Pages 正式網址與 Apps Script Web App URL。

### 影響檔案
- `src/lib/api.ts`
- `.github/workflows/deploy-pages.yml`
- `src/SubmitForm.tsx`
- `src/ApproverDashboard.tsx`
- `src/TrackDashboard.tsx`
- `README.md`
- `WORKLOG.md`

### 驗證
- 已驗證：GitHub Pages workflow 檔案已建立。
- 已驗證：補上 `src/vite-env.d.ts` 後，可讓 `import.meta.env` 通過型別檢查。
- 未驗證：Apps Script 是否已完整支援 `getPendingTickets`、`getMyTickets`、`getTicketLogs` 等 action 名稱仍待實際串接確認。
- 未驗證：管理頁面 `AdminDashboard.tsx` 尚未完成 Apps Script 直連改造。

## 2026-05-06

### 變更摘要
- 更新 `vite.config.ts`，加入 GitHub Pages 發布時的 `base` 路徑支援。
- 新增 `GITHUB_PAGES_APPS_SCRIPT_SOP.md`，整理 GitHub Pages + Google Apps Script 架構的完整操作說明。
- 更新 `README.md` 文件索引，加入 GitHub Pages 架構文件入口。

### 影響檔案
- `vite.config.ts`
- `GITHUB_PAGES_APPS_SCRIPT_SOP.md`
- `README.md`
- `WORKLOG.md`

### 驗證
- 已驗證：GitHub Pages 發布時可自動帶入 repo base path 設定。
- 未驗證：尚未完成前端 API 重構，因此目前仍不可直接部署到 GitHub Pages 正式使用。

## 2026-05-06

### 變更摘要
- 新增 `CLOUD_RUN_DEPLOY_SOP.md`，整理給新手使用的 Google Cloud Run 正式部署步驟。
- 更新 `README.md` 文件索引，加入 Cloud Run 部署文件入口。

### 影響檔案
- `CLOUD_RUN_DEPLOY_SOP.md`
- `README.md`
- `WORKLOG.md`

### 驗證
- 已驗證：部署 SOP 文件已成功建立於專案根目錄。
- 未驗證：尚未實際執行 Cloud Run 部署，因仍需補齊部署平台帳號、權限與 secrets。

## 2026-05-06

### 變更摘要
- 調整 `server.ts` 的啟動埠號邏輯，正式環境可優先使用 `process.env.PORT`，本地則回退到 `3000`。
- 完成部署前關鍵檢查：`npm run lint` 與 `npm run build` 皆已通過。

### 影響檔案
- `server.ts`
- `WORKLOG.md`

### 驗證
- 已驗證：`npm run lint` 通過。
- 已驗證：`npm run build` 通過。
- 已驗證：正式環境現在可由平台注入 `PORT`。

## 2026-05-06

### 變更摘要
- 更新 `LOCAL_TESTING_SOP.md` 的版本確認說明，補上 `node -v` 與 `npm -v` 的正確輸出範例。
- 補充 PowerShell 歡迎訊息與版本號輸出的差異，避免把終端機開場文字誤認成指令結果。

### 影響檔案
- `LOCAL_TESTING_SOP.md`
- `WORKLOG.md`

### 驗證
- 已驗證：本機執行 `node -v` 顯示 `v24.15.0`。
- 已驗證：本機執行 `npm -v` 顯示 `11.12.1`。

## 2026-05-06

### 變更摘要
- 新增 `LOCAL_TESTING_SOP.md`，整理本地端啟動、測試、建置與常見問題排查流程。
- 新增 `WORKLOG.md`，建立後續開發與調整的工作日誌機制。
- 更新 `README.md`，加入文件索引，方便找到 SOP 與工作日誌。

### 影響檔案
- `LOCAL_TESTING_SOP.md`
- `WORKLOG.md`
- `README.md`

### 驗證
- 已驗證：文件已成功建立於專案根目錄。
- 未驗證：未執行 `npm run lint`、`npm run build`，因本次僅新增與調整文件。
