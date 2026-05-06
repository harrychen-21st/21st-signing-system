# 本地端測試 SOP

## 目的
提供這個 `internal-signing-system` 專案在本機啟動、檢查與基本測試的標準操作流程，方便開發、驗證與 demo。

## 專案特性
- 啟動指令是 `npm run dev`
- `dev` 實際執行的是 `tsx server.ts`
- `server.ts` 會啟動 Express 並整合 Vite
- 本機預設埠號是 `3000`
- 若未設定 `GOOGLE_APPS_SCRIPT_URL`，系統會自動使用部分 mock/fallback 資料

## 前置需求
1. 已安裝 Node.js
2. 已安裝 npm
3. 已在本機取得此專案原始碼

## 建議版本確認
在專案根目錄執行：

```powershell
node -v
npm -v
```

正確結果應該會看到版本號，例如：

```text
v24.15.0
11.12.1
```

若你看到這種內容：

```text
Windows PowerShell
著作權（C） Microsoft Corporation。保留擁有權利。
```

這通常只是 PowerShell 剛開啟時的歡迎訊息，不是 `node -v` 或 `npm -v` 的結果。

請在看到 PowerShell 視窗後，再手動輸入或貼上：

```powershell
node -v
npm -v
```

若指令無法執行，先安裝 Node.js 後再繼續。

## Step 1. 安裝相依套件
在專案根目錄執行：

```powershell
npm install
```

預期結果：
- 成功安裝 `package.json` 內的 dependencies 與 devDependencies
- 專案中出現或更新 `node_modules`

## Step 2. 建立本機環境變數檔
以 `.env.example` 為基礎建立 `.env.local`。

至少可先放入：

```env
GEMINI_API_KEY="MY_GEMINI_API_KEY"
APP_URL="http://localhost:3000"
GOOGLE_APPS_SCRIPT_URL=""
```

說明：
- `APP_URL` 本地可先設為 `http://localhost:3000`
- 若沒有串接正式 Google Apps Script，可先將 `GOOGLE_APPS_SCRIPT_URL` 留空
- 留空時，系統部分 API 會使用 mock/fallback 邏輯，方便本機測畫面與基本流程

## Step 3. 啟動本地開發環境
在專案根目錄執行：

```powershell
npm run dev
```

預期結果：
- Node 進程啟動
- Express + Vite 開始提供服務
- 本機可由瀏覽器開啟 `http://localhost:3000`

## Step 4. 開啟畫面
使用瀏覽器進入：

```text
http://localhost:3000
```

若畫面正常，代表前端與本地 server 已成功啟動。

## Step 5. 基本功能測試

### 5.1 首頁 / 主畫面確認
確認：
- 首頁可正常載入
- 無白畫面
- 瀏覽器 Console 無明顯紅色錯誤

### 5.2 申請單流程測試
建議使用以下測試信箱：
- `test@company.com`
- `boss@company.com`
- `admin@company.com`

原因：
- 這些帳號存在於 `server.ts` 的 mock user 資料中

操作：
1. 進入申請表單頁
2. 輸入測試 Email
3. 觸發驗證身分
4. 確認是否成功帶出申請人姓名與部門
5. 選擇表單類型
6. 填寫必要欄位
7. 送出表單

預期結果：
- 若 `GOOGLE_APPS_SCRIPT_URL` 未設定，送出應走 mock success 流程
- 畫面應顯示送出成功與單號

### 5.3 表單種類讀取測試
在未設定 `GOOGLE_APPS_SCRIPT_URL` 時，預期至少可看到預設表單：
- `AP`
- `RD`
- `CS`

若未顯示，需優先檢查前端 API 呼叫與 server console 錯誤。

### 5.4 進度查詢測試
使用同一測試 Email 查詢：
- 畫面是否可正常載入查詢頁
- API 呼叫是否正常
- 若未接 Apps Script，部分資料可能為空，屬正常現象

### 5.5 管理功能測試
若畫面包含管理介面，優先確認：
- 表單種類 API 可讀取
- 規則設定頁可開啟
- 在未串接 GAS 時，某些儲存動作可能只回傳 mock success 或無實際寫入

## Step 6. 型別檢查
執行：

```powershell
npm run lint
```

注意：
- 這個專案的 `lint` 實際上是 `tsc --noEmit`
- 這不是 ESLint，而是 TypeScript 型別檢查

預期結果：
- 若無錯誤，終端不應出現 TypeScript error

## Step 7. 建置測試
執行：

```powershell
npm run build
```

預期結果：
- 成功輸出前端 build 結果
- 產生 `dist` 目錄

## Step 8. 預覽建置結果
執行：

```powershell
npm run preview
```

依終端輸出的 preview URL 進入瀏覽器確認 build 後畫面是否正常。

## 建議測試順序
1. `npm install`
2. 建立 `.env.local`
3. `npm run dev`
4. 開啟 `http://localhost:3000`
5. 測試申請流程
6. `npm run lint`
7. `npm run build`
8. `npm run preview`

## 常見問題排查

### 1. `npm run dev` 啟不來
檢查：
- 是否已執行 `npm install`
- Node.js 版本是否可用
- 終端是否已有明確錯誤訊息

### 2. `localhost:3000` 打不開
檢查：
- `npm run dev` 是否仍在執行
- 3000 埠是否被其他程式占用
- 防火牆或安全軟體是否阻擋

### 3. API 沒資料
可能原因：
- `GOOGLE_APPS_SCRIPT_URL` 未設定
- Apps Script URL 無效
- 後端 fallback 只提供部分 mock 資料

### 4. 送出表單失敗
檢查：
- 瀏覽器 Console
- 啟動中的終端輸出
- 必填欄位是否都已填寫
- 若有設定 `GOOGLE_APPS_SCRIPT_URL`，確認該 Web App 可被存取

### 5. build 失敗
檢查：
- TypeScript 錯誤
- import 路徑錯誤
- 環境變數依賴是否缺漏

## 驗收標準
符合以下條件可視為本地端測試通過：
- `npm install` 成功
- `npm run dev` 成功啟動
- 瀏覽器可開啟 `http://localhost:3000`
- 可用測試信箱完成基本畫面操作
- `npm run lint` 通過
- `npm run build` 通過

## 備註
- 此專案的本地測試可先不依賴正式 Google Apps Script
- 若要驗證完整資料流，需補上可用的 `GOOGLE_APPS_SCRIPT_URL`
- 若要給團隊使用，後續可再把這份 SOP 正式搬到專案內例如 `README.md` 或 `docs/` 目錄
