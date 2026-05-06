# GitHub Pages + Apps Script 完整操作 SOP

## 目的
這份文件說明如何把目前專案改成：
- 前端部署在 GitHub Pages
- 後端資料與流程由 Google Apps Script Web App 提供

這是最接近「平常只用 GitHub 操作」的架構。

## 先講清楚這個方案能做到什麼
這個方案不是完全只靠 GitHub 本體執行所有東西，而是：

1. GitHub 負責原始碼與發版
2. GitHub Pages 負責前端畫面
3. Google Apps Script 負責 API 與資料寫入/查詢

也就是說，你日常主要會操作 GitHub，但系統資料面仍依賴 Apps Script。

## 為什麼這個方案適合你
目前專案有很多 `/api/...` 呼叫，代表原本依賴 `server.ts` 當中介層。若目標是簡化部署並瘦身，最佳方向是：

1. 把前端改成純靜態網站
2. 把 API 請求直接改打 Google Apps Script Web App
3. 移除 `server.ts` 的正式部署責任
4. 用 GitHub Pages 發前端

## 目前你要知道的一個重點
這不是只改設定就完成的事情。

若要真的切到 GitHub Pages + Apps Script，需要做一輪重構，因為目前前端還在呼叫這些 server route：

- `/api/users/:email`
- `/api/form-types`
- `/api/form-definitions`
- `/api/rules/:formType`
- `/api/submit-approval`
- `/api/tickets/pending/:email`
- `/api/tickets/:ticketId/action`
- `/api/tickets/my/:email`
- `/api/tickets/:ticketId/logs`

GitHub Pages 上沒有 `server.ts`，所以這些都必須改成直接呼叫 Apps Script。

## 建議的執行順序

### 階段 1：先準備 GitHub Pages 發布能力
這一階段先把前端發布流程打通。

### 階段 2：整理 Google Apps Script API
這一階段要確認 Apps Script 能處理所有目前前端需要的功能。

### 階段 3：前端改為直接打 Apps Script
這一階段會是主要重構工作。

### 階段 4：移除正式環境對 `server.ts` 的依賴
本地可保留輔助用途，但正式環境不再需要它。

---

## Part A. GitHub Pages 基本設定

### Step 1. 確認 GitHub repository 名稱
例如你的 repo URL 若是：

```text
https://github.com/your-account/internal-signing-system
```

那 repo 名稱就是：

```text
internal-signing-system
```

GitHub Pages 會用到這個名稱當作子路徑。

### Step 2. 確認 Vite 已支援 GitHub Pages base path
這一步我已先幫你做了。

目前 `vite.config.ts` 已加入 GitHub Pages 環境判斷，在 GitHub Actions 發布時會自動使用：

```text
/<repo-name>/
```

這樣靜態資源路徑才不會壞掉。

### Step 3. 建立 GitHub Pages workflow
這一步通常需要新增 `.github/workflows/deploy-pages.yml`。

功能是：
1. 安裝依賴
2. 執行 `npm run build`
3. 把 `dist/` 發佈到 GitHub Pages

這部分我下一輪可以直接幫你做。

### Step 4. 在 GitHub repo 開啟 Pages
GitHub 網頁操作：

1. 打開你的 repo
2. 點 `Settings`
3. 左側點 `Pages`
4. Source 選 `GitHub Actions`

這樣之後就由 workflow 自動發布。

---

## Part B. Google Apps Script 準備

### Step 5. 確認 Apps Script 現在能處理哪些 API
你目前的前端需要的功能不少，因此 Apps Script 至少要能支援：

1. 查使用者
2. 讀表單種類
3. 新增表單種類
4. 讀表單定義
5. 寫表單定義
6. 讀簽核規則
7. 寫簽核規則
8. 送出申請
9. 查主管待簽核單
10. 執行核准/駁回
11. 查個人申請單
12. 查簽核歷程

### Step 6. Apps Script Web App 要可公開或可被前端呼叫
Apps Script 需部署為 Web App，並回傳一個 URL，例如：

```text
https://script.google.com/macros/s/XXXXXXXXXXXX/exec
```

這個 URL 會成為前端 API base URL。

### Step 7. Apps Script 必須處理 CORS
因為 GitHub Pages 網址會直接從瀏覽器打 Apps Script，Apps Script 必須：

1. 正確回傳 JSON
2. 可被前端跨來源呼叫

若 Apps Script 沒做好這一層，前端會在瀏覽器被 CORS 擋掉。

---

## Part C. 專案重構方向

### Step 8. 建立前端 API client
建議把現在散落在各元件中的 `fetch('/api/...')` 改成統一由一個 API client 處理，例如：

```text
src/lib/api.ts
```

這個檔案統一負責：
- base URL
- query string
- GET / POST 包裝
- 錯誤處理

### Step 9. 把所有 `/api/...` 呼叫改成 Apps Script URL
目前所有 dashboard 都直接打本地 server route，之後要改成：

- `fetch('/api/form-types')`
  變成
- `fetch('https://script.google.com/.../exec?action=getFormTypes')`

實務上不會每個元件都手寫，而是透過 API client 包裝。

### Step 10. 移除正式環境對 `server.ts` 的依賴
完成 API client 重構後：

- GitHub Pages 只負責靜態檔案
- `server.ts` 不再需要部署到正式環境

保留 `server.ts` 的唯一合理用途，是本地模擬或過渡期工具。

### Step 11. 清理過肥元件
目前專案偏肥大的主要點有兩種：

1. `server.ts` 責任過多
2. 各 dashboard 同時包 UI、資料抓取、送出流程、狀態管理

建議拆法：

1. `src/lib/api.ts`
2. `src/lib/forms.ts`
3. `src/lib/tickets.ts`
4. `src/components/...`
5. 將大型頁面中的 modal 或列印元件拆出

這一輪才會真正改善肥大問題。

---

## Part D. 你作為新手的實際操作順序

### 先做的 5 步
1. 確認 repo 已 push 到 GitHub
2. 確認 GitHub Pages 已準備啟用
3. 確認 Apps Script Web App URL 已可用
4. 確認 Apps Script API 功能齊全
5. 再開始前端 API 重構

### 不建議直接做的事
不要在還沒完成 API 重構前，就直接把目前 build 發上 GitHub Pages，因為現在頁面仍然依賴 `/api/...`，上線後一定壞。

---

## 你現在最需要理解的結論

### 可以做到
- 主要用 GitHub 管理與發布
- 正式前端用 GitHub Pages
- 順便把專案瘦身

### 不能直接一步到位的原因
- 目前前端仍依賴本地 `server.ts`
- 必須先做 API 重構

---

## 最建議的下一步
如果你確定要走這條路，最合理的下一步不是先部署，而是先做這三件事：

1. 建 GitHub Pages workflow
2. 建前端 API client
3. 把現有頁面的 `/api/...` 改成 Apps Script 直連

這樣才是真正把專案改成適合 GitHub Pages 的版本。
