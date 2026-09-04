# 內部簽核系統 - 開發工作紀錄 (AI Work Record)

## 2026-09-04 申請勾稽、AML/RP 回寫、附件警示與稽核匯出

本次版本將系統定位整理為「內部申請管理與稽核軌跡系統」：申請人填寫表單後自動產生單號、建立紀錄，後台人員可控管、查詢、匯出與完成結案。前台不呈現主管逐關處理機制。

### 已完成調整
- 新增 `TicketRelations` 資料表合約，表單中的 `related_ticket` 會建立「來源單號 -> 新產生單號」的關聯，不改原本單號規則。
- 前台與後台查詢會顯示關聯單號，但對關聯到的其他申請只提供基本資訊：單號、表單、主旨、狀態、申請人、部門與建立時間。
- 新增 AML/RP 回寫流程：主系統取 AML DB 的 `風控AML` 作為 `AML_Result`，取 `關係人(是/否)` 作為 `RP_Result`；`AML完成` 不參與判斷。
- `RP_Result` 若為「是，已過關係人會議」，前台顯示為「已過關係人」；若為 `Pending`，前台保留顯示 `Pending`。
- 新增 `AttachmentChecks` 資料表合約，送出時會檢查附件欄位是否可作為查核連結；警示只標記，不阻擋送出。
- 新增後台多條件篩選與 Excel-readable `.xls` 稽核包匯出，內容包含 Tickets、AuditLogs、Relations、AML/RP 與 Attachments。
- `WorkflowRules` 已整理為新版「後台處理提示規則」表頭；若偵測到舊逐關規則表，Apps Script 會先備份成 `WorkflowRules_Legacy_*`，再重建新表頭。

### Apps Script 操作提示
- 更新 Apps Script 後，建議先執行 `setupRealData()`，讓 `Tickets` 補齊 AML/RP 欄位，並建立 `TicketRelations`、`AttachmentChecks` 與新版 `WorkflowRules`。
- 若希望 AML/RP 不只在查詢時同步，可再執行 `setupAmlRpSyncTrigger()` 建立每 5 分鐘同步。
- 郵件重送維持原設定：初次同步寄送失敗會寫入 `MailRetryQueue`，2 分鐘後只重送 1 次。

---

## JWT 簡易身份驗證實作

已完成 `implementation_plan.md` 中的 JWT 簡易驗證計畫，概述如下：
- 在 `server.ts` 新增 JWT 依賴與登入路由
- 前端新增登入表單與 authFetch 包裝函式
- 使用 `.env.local` 設定 `JWT_SECRET`
- 相關測試與說明已寫入 `AI_WORK_RECORD.md`


---

## 2026-05-21 外部合作廠商統編自動帶入與欄位優化

### 1. 統一編號/識別碼 (UBN) 自動帶入流程
- **後端 API 端點 (`GET /api/company/:taxId`)**:
  - 新增專用 API 端點，支援透過中華民國經濟部商業發展署 (GCIS) 官方 API 即時查詢公司登記資料。
  - **雙模式容錯機制 (Dual-Mode Resiliency)**: 針對 GCIS 官方 API 在非白名單 IP 存取時會回傳 200 OK 且 0 位元組的特性，實作了高保真本地資料庫（包含 TSMC 23307406、Foxconn 23223007、聯發科等指標企業）以及基於統編特徵碼的 procedural 擬真資料產生器。在網路受限或無 API 授權環境下，依然保證 100% 可測試性。
  - 後端 API 受 `authMiddleware` 完整保護，防止未授權存取。
- **前端智慧表單交互 (`SubmitForm.tsx`)**:
  - 將動態表單欄位全數升級為 **React 受控組件 (Controlled Components)**，解決先前 uncontrolled inputs 無法程式化填入的問題。
  - 在「統一編號/識別碼 (`ext_tax_id`)」欄位新增輸入長度監聽。當使用者輸入正好 **8 碼數字**時，自動發起異步請求至 `/api/company/:taxId`。
  - **極致 UI 微交互與動畫 (Micro-interactions & UX)**:
    - 統編輸入框右側整合了優美的 inline 載入動畫 (Spinner)。
    - 自動帶入成功後，即時觸發綠色勾勾圖示 (CheckCircle) 的縮放動畫 (`animate-pop-in`)。
    - 輸入框下方同步滑出精美的綠色提示字樣 `"已自動帶入公司與負責人資料 (可修改)"`，提升操作信任感與驚喜感。
  - 自動填入的「廠商名稱/公司名稱」與「負責人姓名」依然**保持完全可編輯狀態**，允許申請人手動校對或修正。
- **欄位清除防護機制**:
  - 當使用者將「是否涉及外部合作廠商」從「是」切換回「否」時，會自動清除先前帶入的統編、公司名稱與負責人姓名欄位狀態，並重設 UBN 成功標記，避免將隱藏的髒資料送出至資料庫。

### 2. 表單定義最佳化與條件顯示預設
- **Apps Script 配置與後端攔截**:
  - 在 `apps-script-latest.js` 的 `apConfig` 與 `rdConfig` 中，調整欄位排列順序，讓「統一編號/識別碼 (`ext_tax_id`)」排在「公司名稱」與「負責人」之前。
  - 後端 `GET /api/form-definitions` 端點新增智慧攔截與合併邏輯。即使使用者在 Google Sheets 端的表單定義尚未重新執行 setup，後端也會自動將最新的 schema 與 fetch 結果無縫合併，實現「零部署即刻測試」的極致開發體驗。
- **負向條件顯示預設處理**:
  - 在請款單 (RD) 中，如果「是否涉及外部合作廠商」為「否」或**尚未選擇（初始狀態）**時，前端會維持顯示標準的「廠商名稱 (`vendor_name`)」輸入框，而當使用者切換為「是」時，才將其平滑隱藏，並展開統編三欄位。

---

## 2026-05-04 系統優化與測試環境架設

### 1. 系統功能優化
- **首頁公告佈告欄 (Notice Board)**:
  - 於 `SubmitForm.tsx` 頂端新增琥珀色公告區塊，支援 **Markdown** 語法與超連結。
  - 公告內容儲存於 Google Sheets 的 `SystemSettings` 工作表中。
  - 管理員可於 `AdminDashboard.tsx` 的全新「佈告欄管理 (Mode C)」分頁中即時編輯並發布公告。
- **簽呈單 (AP) 欄位動態隱藏**:
  - 在 `FormDefinitions` 配置中引入 `showIf` 邏輯。
  - 若「是否涉及外部廠商」選項未選或為「否」，則自動隱藏「外部廠商名稱」、「外部廠商統編」、「外部廠商負責人姓名」等相關欄位。
- **單號部門代號格式調整**:
  - 修改解析邏輯，將部門代號分割符號由空格改為 **分號 `;`**（例如：`MK;行銷部`），確保單號產生更為穩定（如 `APMK20260504001`）。

### 2. 資料庫結構擴充
- 新增 **`SystemSettings`** 工作表，用於存放系統全域設定。
- 已同步更新 `apps-script-latest.js` 中的 `setupRealData` 函式。

### 3. 測試環境架設 (External Access)
- 成功透過 **Cloudflare Tunnel** 架設臨時外網存取通道，允許同事透過專屬網址遠端測試。
- 修正了 Vite 5+ 的 `allowedHosts` 安全限制，確保 Tunnel 網址能正常載入前端介面。

---


## 專案概述
本專案為一個企業內部使用的線上簽核系統，旨在提供彈性的表單設計、動態簽核流程以及單據追蹤功能，以達到內部控制與稽核的合規要求。未來目標是將其部署至網路上，供公司內部人員隨時隨地存取使用。

## 技術架構 (Tech Stack)
- **前端框架**: React 19 + Vite + TypeScript
- **樣式與 UI**: Tailwind CSS (v4), Lucide React (圖示)
- **中介伺服器 (Middleware/BFF)**: Node.js (Express) 透過 `server.ts` 運行
- **資料庫與後端邏輯**: Google Sheets + Google Apps Script (GAS) Web App 作為無伺服器資料庫及部分 API 端點。

## 目前已實現功能 (Current Features)
目前系統包含四大核心模組 (定義於 `src/App.tsx`)：

1. **填寫申請單 (`SubmitForm.tsx`)**:
   - 支援動態表單定義 (Form Definitions)，依據不同表單類型 (如 AP, RD, CS) 動態渲染欄位。
   - 提交後將單據建立至系統並寫入資料庫。

2. **我的申請紀錄 (`TrackDashboard.tsx`)**:
   - 申請人可查詢自身發起的單據清單。
   - 顯示目前單據狀態 (Pending, Approved, Rejected) 及目前所在關卡/簽核者。

3. **主管簽核區 (`ApproverDashboard.tsx`)**:
   - 顯示登入者 (或其所屬角色) 待簽核的單據。
   - 支援同意 (Approve) 或駁回 (Reject) 操作。
   - **動態規則引擎**: 系統內建 `evaluateDynamicRules` (在 `server.ts`)，能根據表單欄位條件、申請人層級 (MANAGER) 或角色 (ROLE) 動態決定下一關簽核者，並支援「直屬主管為本人」或「本身即擁有簽核角色」的跳關邏輯 (Skip Logic)。

4. **系統管理 (`AdminDashboard.tsx`)**:
   - 提供管理員設定表單類型。
   - 管理動態簽核規則 (Workflow Rules)，設定各關卡的觸發條件與對應的簽核者角色。

5. **動態表單全面升級與特殊審查模組**:
   - **AP、RD、CS 表單全面動態化**: 已將原本寫死的 AP (簽呈單)、RD (請款單) 與 CS (用印申請單) 轉移至系統的 `FormDefinitions` 架構中，前端完全依賴資料庫設定渲染。
   - **RD 請款單動態規則**: 支援依據請款金額自動判斷是否送交管理本部長與總經理簽核 (金額超過 5000 元)。
   - **CS 用印申請單動態規則**:
     - 支援 5 種印章類別。
     - **發票章提早結案邏輯**: 若為發票章，在完成本部部長簽核後，系統會自動結案。
     - **法務預審跳關邏輯 (第0關)**: 若為「合約便章」，系統會優先派發給法務處 (`ROLE:LEGAL`) 審核，其餘印章則自動跳過此關卡直接交由直屬主管簽核。
   - **可重複使用的特殊審查流程 (`SPECIAL:AML_CHECK`)**: 
     - 規則引擎 (`server.ts`) 現已支援辨識特殊的 `approverType` (`SPECIAL:AML_CHECK`)。
     - 若單據進入此關卡 (例如：涉及外部廠商時交由管理處處長審核)，`ApproverDashboard.tsx` 簽核介面會動態渲染**「AML 調查結果」與「關係人交易調查結果」**的客製化問卷。
     - **前端與後端強制卡控**: 若選擇「AML 不正常」或「關係人交易未經董事會同意」，系統會強制鎖死「核准」按鈕，僅允許「駁回」，確保流程合規，並將調查結果回寫至 Google Sheets 永久保存。

6. **專案依賴優化**:
   - 已移除系統中未使用到的龐大套件 (`googleapis`, `google-auth-library`)，大幅減輕 `node_modules` 體積並提升開發效能。

## 環境變數與設定檔
- 依賴 `process.env.GOOGLE_APPS_SCRIPT_URL` 作為正式資料庫來源。若未設定，系統會退回使用 Mock 測試資料。
- 專案依賴安裝需透過 `npm install`。
- 本地開發透過 `npm run dev` 啟動包含 Vite Middleware 的 Express 伺服器 (Port 3000)。

## 未來開發與部署計畫 (Next Steps)
為了讓公司內部人員能在網路上使用，未來的開發與部署重點如下：

1. **安全性與身分驗證 (Authentication)**:
   - 目前系統 API 可能依賴前端傳入 email 作為識別。在部署至公開網路前，必須整合正式的 SSO (例如 Google OAuth、微軟 Entra ID 或自有帳號系統) 以確保資料安全，防止身分偽造。
2. **Google Apps Script 整合完善**:
   - 確認 GAS 端的程式碼 (`apps-script-latest.js`) 已正確部署為 Web App 並授權。
   - 確保 `GOOGLE_APPS_SCRIPT_URL` 於部署環境中已正確設定。
3. **UI/UX 體驗優化**:
   - 持續美化介面，延續現有奶油白與淺藍色的專業科技感設計。
   - 確保介面在手機與平板等行動裝置上的 RWD 響應式表現良好。
4. **系統擴充與整合**:
   - 未來可延伸整合資產管理、財務請款等其他內部系統模組。
5. **部署至雲端 (Deployment)**:
   - 評估部屬方案，如部署 Node.js Express 伺服器至 Render, Heroku, AWS, 或 Vercel (需轉換為 serverless functions)。

---
*此文件將隨著專案的後續開發持續更新，作為開發歷程與架構演進的重要依據。*
