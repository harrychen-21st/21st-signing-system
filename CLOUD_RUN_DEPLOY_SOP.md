# Cloud Run 部署 SOP

## 目的
這份文件提供新手將 `internal-signing-system` 部署到 Google Cloud Run 的完整操作步驟。

## 這個專案的部署方式
這個專案不是純靜態網站，因為它有：
- `server.ts`
- Express API
- 環境變數
- 對外呼叫 Google Apps Script Web App

因此不適合用 GitHub Pages，適合部署到可執行 Node.js 伺服器的環境，例如 Google Cloud Run。

## 部署前你需要準備的東西
1. 一個 Google 帳號
2. 一個 Google Cloud 專案
3. 已綁定帳單的 Google Cloud 專案
4. 已安裝並登入 `gcloud` CLI
5. 專案原始碼已在 GitHub 或本機
6. 正式可用的 `GOOGLE_APPS_SCRIPT_URL`
7. 正式使用的 `GEMINI_API_KEY`

## 這次部署會用到的環境變數
Cloud Run 需要至少設定以下 3 個環境變數：

- `GEMINI_API_KEY`
- `APP_URL`
- `GOOGLE_APPS_SCRIPT_URL`

## Step 1. 建立或確認 Google Cloud 專案
進入 Google Cloud Console：

```text
https://console.cloud.google.com/
```

操作：
1. 點上方專案選單
2. 建立新專案，或選擇既有專案
3. 記下你的 `Project ID`

`Project ID` 很重要，後面部署會用到。

## Step 2. 啟用帳單
如果 Cloud Run 尚未能使用，通常是因為帳單未啟用。

操作：
1. 在 Google Cloud Console 左側進入 `Billing`
2. 確認目前專案已綁定付款帳戶

## Step 3. 安裝 Google Cloud CLI
若你尚未安裝 `gcloud`，請先安裝：

```text
https://cloud.google.com/sdk/docs/install
```

安裝完成後，在 PowerShell 執行：

```powershell
gcloud --version
```

如果看到版本資訊，表示安裝成功。

## Step 4. 登入 gcloud
在 PowerShell 執行：

```powershell
gcloud auth login
```

操作說明：
1. 瀏覽器會開啟 Google 登入頁
2. 使用你要部署的 Google 帳號登入
3. 完成授權

## Step 5. 設定目前使用的專案
把下面的 `YOUR_PROJECT_ID` 換成你的 Google Cloud 專案 ID：

```powershell
gcloud config set project YOUR_PROJECT_ID
```

確認設定成功：

```powershell
gcloud config get-value project
```

## Step 6. 啟用必要 API
在 PowerShell 執行：

```powershell
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

這三個服務分別負責：
- Cloud Run
- Cloud Build
- Container / image registry

## Step 7. 確認專案本地可建置
在專案根目錄執行：

```powershell
npm run lint
npm run build
```

這一步目前已經通過，但若你部署前又改過程式，建議再跑一次。

## Step 8. 建立 Dockerfile
Cloud Run 最穩定的做法之一是用 Dockerfile 部署。

如果目前專案還沒有 `Dockerfile`，需要先新增。這部分我可以幫你做。

一個基本方向會是：
1. 安裝 dependencies
2. 執行 `npm run build`
3. 用 `npm start` 啟動 `server.ts`

注意：
- 如果正式環境直接執行 `node server.ts`，Node.js 對 TypeScript 原生支援可能依版本與語法而有差異
- 更穩定的方式通常是改成 production 啟動編譯後的 server，或使用明確 runtime 策略

這也是目前部署前還需要做的技術調整之一。

## Step 9. 第一次部署到 Cloud Run
若專案已備妥 Dockerfile，可在專案根目錄執行：

```powershell
gcloud run deploy internal-signing-system ^
  --source . ^
  --region asia-east1 ^
  --allow-unauthenticated
```

說明：
- `internal-signing-system` 是 Cloud Run 服務名稱，可自行修改
- `--source .` 代表直接用目前專案目錄建置並部署
- `--region asia-east1` 可改成你偏好的區域
- `--allow-unauthenticated` 代表允許公開存取網址

如果你在 PowerShell 使用多行指令不順，也可改成單行：

```powershell
gcloud run deploy internal-signing-system --source . --region asia-east1 --allow-unauthenticated
```

## Step 10. 在部署過程中設定環境變數
部署時 Cloud Run 可能會要求你填寫環境變數。

你至少要準備：

```text
GEMINI_API_KEY=你的正式金鑰
APP_URL=先留空或部署完成後再更新
GOOGLE_APPS_SCRIPT_URL=你的正式 Apps Script Web App URL
```

更穩定的方式是第一次部署後，再補設定環境變數。

## Step 11. 取得正式網址
部署成功後，Cloud Run 會回傳一個網址，例如：

```text
https://internal-signing-system-xxxxxx-uc.a.run.app
```

把這個網址記下來。

## Step 12. 更新 `APP_URL`
部署成功後，用正式網址更新 Cloud Run 的環境變數：

```powershell
gcloud run services update internal-signing-system --region asia-east1 --update-env-vars APP_URL=https://YOUR_CLOUD_RUN_URL
```

如果還要一次補其他環境變數，也可以一起帶入：

```powershell
gcloud run services update internal-signing-system --region asia-east1 --update-env-vars APP_URL=https://YOUR_CLOUD_RUN_URL,GEMINI_API_KEY=YOUR_KEY,GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
```

## Step 13. 驗證正式環境
部署完成後，請用瀏覽器打開 Cloud Run 網址，並測試：

1. 首頁是否能開啟
2. 使用者查詢是否正常
3. 表單種類是否可載入
4. 表單送出是否成功
5. 簽核歷程是否可讀取

## Step 14. 若你要走 GitHub 自動部署
你可以把這個專案推到 GitHub，再使用：

- Cloud Build Trigger
- 或 Cloud Run 連接來源倉庫

常見流程：
1. push 到 GitHub
2. Cloud Build 偵測 push
3. 自動 build image
4. 自動部署到 Cloud Run

這部分可以等第一次手動部署成功後再做，難度會低很多。

## 常見問題

### 1. `gcloud` 指令不能用
請先確認：

```powershell
gcloud --version
```

### 2. 沒有權限部署
可能原因：
- 沒登入正確 Google 帳號
- Google Cloud 專案沒有足夠 IAM 權限
- 專案沒有啟用帳單

### 3. 部署成功但網站打不開
檢查：
- Cloud Run revision log
- 是否有正確監聽 `PORT`
- 啟動指令是否正常

### 4. 畫面正常但 API 沒資料
檢查：
- `GOOGLE_APPS_SCRIPT_URL` 是否正確
- Apps Script Web App 是否對外可用
- 權限是否允許 Cloud Run 呼叫

## 目前最重要的觀念
第一次上 Cloud Run，不要一開始就做 GitHub 全自動部署。

最佳順序：
1. 先手動部署一次成功
2. 確認正式網址可用
3. 確認環境變數與 Apps Script 串接正常
4. 再做 GitHub 自動部署

## 你接下來最建議先做的事
1. 安裝並確認 `gcloud`
2. 登入 `gcloud`
3. 設定 Google Cloud 專案
4. 啟用 Cloud Run / Cloud Build / Artifact Registry API
5. 再進行第一次部署

## 目前狀態補充
這份 SOP 已經可以作為 Cloud Run 新手部署指南，但專案本身若要穩定上 Cloud Run，通常還需要補 Dockerfile 與 production 啟動策略。這部分可直接在下一步由我處理。
