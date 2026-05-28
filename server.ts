import express, { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config({ path: '.env.local' });
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';

declare global {
  namespace Express {
    interface Request {
      user?: {
        email: string;
        name: string;
        dept: string;
        manager: string;
        roles: string[];
      };
    }
  }
}

// === Authentication Middleware ===
const authMiddleware = (req: Request, res: Response, next: NextFunction): any => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded as any;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

const parseJsonCell = (value: any) => {
  if (!value) return {};
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return {};
  }
};

const extractDeptCode = (department = '') => {
  const match = String(department).trim().match(/^[A-Za-z0-9]+/);
  return (match?.[0] || 'XX').toUpperCase();
};

const postToAppsScript = async (scriptUrl: string, payload: any) => {
  const response = await fetch(scriptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned invalid JSON: ${text.substring(0, 160)}`);
  }
  if (!response.ok || !result.success) {
    throw new Error(result.error || `Apps Script returned status: ${response.status}`);
  }
  return result;
};

const defaultFormTypes = [
  { id: 'AP', name: '簽呈單 (AP)' },
  { id: 'RD', name: '請款單 (RD)' },
  { id: 'CS', name: '用印申請單 (CS)' }
];

const meetingRoomHeaders = ['RoomID', 'RoomName', 'Location', 'Capacity', 'IsActive', 'SortOrder', 'OpenTime', 'CloseTime', 'CreatedAt'];
const meetingBookingHeaders = ['BookingID', 'RoomID', 'RoomName', 'BookerEmail', 'BookerName', 'Department', 'Date', 'StartTime', 'EndTime', 'Purpose', 'Status', 'CreatedAt', 'UpdatedAt', 'CancelledAt', 'CancelledBy', 'ReminderSentAt'];

const isAdminUser = (user?: { roles?: string[] }) => user?.roles?.includes('ROLE:ADMIN');

const rowToObject = (headers: string[], row: any[]) =>
  headers.reduce((record: Record<string, any>, header, index) => {
    record[header] = row[index] ?? '';
    return record;
  }, {});

const mapMeetingRoom = (row: any[]) => {
  const item = rowToObject(meetingRoomHeaders, row);
  return {
    id: item.RoomID,
    name: item.RoomName,
    location: item.Location,
    capacity: item.Capacity,
    isActive: String(item.IsActive || '').toUpperCase() !== 'FALSE',
    sortOrder: Number(item.SortOrder || 0),
    openTime: item.OpenTime || '09:00',
    closeTime: item.CloseTime || '18:00',
    createdAt: item.CreatedAt
  };
};

const mapMeetingBooking = (row: any[]) => {
  const item = rowToObject(meetingBookingHeaders, row);
  return {
    id: item.BookingID,
    roomId: item.RoomID,
    roomName: item.RoomName,
    bookerEmail: item.BookerEmail,
    bookerName: item.BookerName,
    department: item.Department,
    date: item.Date,
    startTime: item.StartTime,
    endTime: item.EndTime,
    purpose: item.Purpose,
    status: item.Status || 'Booked',
    createdAt: item.CreatedAt,
    updatedAt: item.UpdatedAt,
    cancelledAt: item.CancelledAt,
    cancelledBy: item.CancelledBy,
    reminderSentAt: item.ReminderSentAt
  };
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // ============================================================================
  // API Routes (Using Google Apps Script Web App as the database interface)
  // ============================================================================
  
  // === Authentication Route ===
  app.post("/api/auth/login", async (req, res): Promise<any> => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const lowerEmail = email.toLowerCase();
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    // Fallback mock user if no script URL
    let userInfo: any = { name: '預設測試員 (Test)', dept: 'CS (客服處)', manager: '', roles: 'ROLE:EMPLOYEE' };

    if (scriptUrl) {
      try {
        const response = await fetch(`${scriptUrl}?action=getUser&email=${encodeURIComponent(lowerEmail)}`);
        if (response.ok) {
          const text = await response.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch(e) {
            console.error("Parse error on login response", text);
            return res.status(500).json({ error: "Database response error" });
          }
          if (data.success && data.user) {
            userInfo = data.user;
          } else {
             return res.status(401).json({ error: data.error || "User not found in directory" });
          }
        }
      } catch (err) {
        console.error("Login Error fetching user:", err);
      }
    } else {
      const mockDbUsers: Record<string, any> = {
        'test@company.com': { name: '陳小明 (Ming Chen)', dept: 'MK (行銷企劃部)', manager: 'boss@company.com', roles: 'ROLE:EMPLOYEE' },
        'boss@company.com': { name: '李大方 (David Lee)', dept: 'GM (總經理室)', manager: '', roles: 'ROLE:EMPLOYEE,ROLE:DEPT_HEAD,ROLE:GM' },
        'admin@company.com': { name: '王維運 (Admin)', dept: 'IT (資訊處)', manager: '', roles: 'ROLE:ADMIN' }
      };
      if (mockDbUsers[lowerEmail]) userInfo = mockDbUsers[lowerEmail];
      else return res.status(401).json({ error: "User not found (Mock)" });
    }

    const payload = {
      email: lowerEmail,
      name: userInfo.name,
      dept: userInfo.dept,
      manager: userInfo.manager,
      roles: (userInfo.roles || '').split(',').map((r: string) => r.trim()).filter(Boolean)
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: payload });
  });

  // 1. Fetch User from Google Sheets via Apps Script (Fallback to Mock if not configured)
  app.get("/api/users/:email", authMiddleware, async (req, res): Promise<any> => {
    const email = req.params.email.toLowerCase();
    
    // Fallback mock data
    const mockDbUsers: Record<string, { name: string; dept: string }> = {
      'test@company.com': { name: '陳小明 (Ming Chen)', dept: 'MK (行銷企劃部)' },
      'boss@company.com': { name: '李大方 (David Lee)', dept: 'GM (總經理室)' },
      'admin@company.com': { name: '王維運 (Admin)', dept: 'IT (資訊處)' }
    };

    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    if (!scriptUrl) {
      console.warn("GOOGLE_APPS_SCRIPT_URL is not set. Using mock user data.");
      if (mockDbUsers[email]) {
        return res.json({ success: true, user: { ...mockDbUsers[email], manager: '', roles: '' }, source: 'mock' });
      } else {
        return res.json({ success: true, user: { name: '預設測試員 (Test Role)', dept: 'CS (客服處)', manager: '', roles: '' }, source: 'mock' });
      }
    }

    try {
      // Call the Google Apps Script Web App (GET request)
      const response = await fetch(`${scriptUrl}?action=getUser&email=${encodeURIComponent(email)}`);
      
      if (!response.ok) {
        throw new Error(`Apps Script returned status: ${response.status}`);
      }

      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
         console.error("Apps Script returned HTML instead of JSON:", responseText.substring(0, 200));
         return res.json({ success: false, error: "Apps Script 權限錯誤：請確認 Google Apps Script 的存取權限是否設為「所有人 (Anyone)」。" });
      }

      // If Apps Script returns an error inside JSON, treat as error
      if (data.error || !data.success || !data.user) {
         return res.json({ success: false, error: data.error || "User not found in spreadsheet" });
      }
      return res.json({ success: true, user: data.user, source: 'sheets' });

    } catch (error: any) {
      console.error("Error fetching users from Apps Script:", error);
      return res.json({ success: false, error: error.message || 'Failed to connect to directory' });
    }
  });

  // --- UBN / Tax ID Auto-Fill API ---
  app.get("/api/company/:taxId", authMiddleware, async (req, res): Promise<any> => {
    const taxId = req.params.taxId.trim();
    if (!/^\d{8}$/.test(taxId)) {
      return res.status(400).json({ error: "統一編號格式錯誤，必須為 8 碼數字" });
    }

    const mockCompanies: Record<string, { name: string; owner: string }> = {
      '23307406': { name: '台灣積體電路製造股份有限公司', owner: '魏哲家' },
      '23223007': { name: '鴻海精密工業股份有限公司', owner: '劉揚偉' },
      '23628048': { name: '聯華電子股份有限公司', owner: '洪嘉聰' },
      '24033111': { name: '聯發科技股份有限公司', owner: '蔡力行' },
      '04170449': { name: '中華電信股份有限公司', owner: '郭水義' },
      '27233186': { name: '外商亞馬遜網路服務有限公司台灣分公司', owner: '王定愷' },
      '22099131': { name: '美商微軟股份有限公司台灣分公司', owner: '卞志祥' },
      '84149961': { name: '美商 Google 台灣分公司', owner: '簡立峰' }
    };

    const url = `https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6?$format=json&$filter=Business_Accounting_NO%20eq%20'${taxId}'`;

    try {
      console.log(`[GCIS API] Fetching details for Tax ID: ${taxId}`);
      const apiResponse = await fetch(url);
      
      if (apiResponse.ok) {
        const text = await apiResponse.text();
        if (text && text.trim().length > 0) {
          let data;
          try {
            data = JSON.parse(text);
          } catch (e) {
            console.warn(`[GCIS API] Non-JSON or malformed response: ${text.substring(0, 100)}`);
          }

          if (data) {
            const record = Array.isArray(data) ? data[0] : data;
            if (record && record.Company_Name) {
              console.log(`[GCIS API] Match found: ${record.Company_Name}`);
              return res.json({
                success: true,
                name: record.Company_Name,
                owner: record.Responsible_Name || '',
                source: 'gcis_api'
              });
            }
          }
        }
      }
      console.warn(`[GCIS API] Returned status ${apiResponse.status} or empty content. Falling back to local dictionary/generator.`);
    } catch (err: any) {
      console.error("[GCIS API] Error during request:", err.message);
    }

    if (mockCompanies[taxId]) {
      console.log(`[Local Mock] Match found for ${taxId}: ${mockCompanies[taxId].name}`);
      return res.json({
        success: true,
        name: mockCompanies[taxId].name,
        owner: mockCompanies[taxId].owner,
        source: 'local_dictionary'
      });
    }

    const lastNamePool = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊'];
    const middleNamePool = ['建', '信', '冠', '志', '家', '俊', '雅', '婷', '佳', '欣'];
    const firstNamePool = ['宏', '廷', '宇', '豪', '傑', '銘', '涵', '萱', '茹', '君'];

    const ubnSum = taxId.split('').reduce((sum, char) => sum + parseInt(char, 10), 0);
    const lastName = lastNamePool[ubnSum % lastNamePool.length];
    const middleName = middleNamePool[(ubnSum * 3) % middleNamePool.length];
    const firstName = firstNamePool[(ubnSum * 7) % firstNamePool.length];
    const mockOwnerName = `${lastName}${middleName}${firstName}`;

    const mockCompanyName = `模擬外部合作商股份有限公司 (統編: ${taxId})`;

    console.log(`[Mock Generator] Generated vendor for ${taxId}: ${mockCompanyName}`);
    return res.json({
      success: true,
      name: mockCompanyName,
      owner: mockOwnerName,
      source: 'local_generator'
    });
  });

  // ============================================================================
  // Admin Dashboard APIs (Form Types, Rules & Settings)
  // ============================================================================
  
  app.get("/api/settings/:key", authMiddleware, async (req, res): Promise<any> => {
    const { key } = req.params;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.json({ value: "歡迎使用企業內部簽核系統！\n\n- 若有任何系統操作問題，請聯繫 [IT 資訊處](#)。\n- [點擊此處查看簽核流程規範文件](#)" });
    }

    try {
      const response = await fetch(`${scriptUrl}?action=getData&sheet=SystemSettings`);
      const data = await response.json();
      const rows = data.data || [];
      const settingRow = rows.find((r: any) => r[0] === key);
      res.json({ value: settingRow ? settingRow[1] : "" });
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", authMiddleware, async (req, res): Promise<any> => {
    const { key, value } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true });

    try {
      const payload = {
        action: 'saveData',
        sheet: 'SystemSettings',
        matchColumn: 1, // Key
        matchValue: key,
        row: [key, value]
      };
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving setting:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get("/api/form-types", authMiddleware, async (req, res): Promise<any> => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.json({ formTypes: defaultFormTypes });
    }

    try {
      const response = await fetch(`${scriptUrl}?action=getFormTypes`);
      const data = await response.json();
      const rows = data.data || [];
      const formTypes = rows.slice(1)
        .map((r: any) => ({ id: r[0], name: r[1] }))
        .filter((form: any) => form.id && form.name);
      res.json({ formTypes: formTypes.length ? formTypes : defaultFormTypes });
    } catch (error) {
      console.error("Error fetching form types:", error);
      res.status(500).json({ error: "Failed to fetch form types" });
    }
  });

  app.post("/api/form-types", authMiddleware, async (req, res): Promise<any> => {
    const { id, name } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true });

    try {
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addFormType', formId: id, formName: name })
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error adding form type:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/form-definitions", authMiddleware, async (req, res): Promise<any> => {
    const localDefinitions = [
      {
        formId: 'AP',
        fieldsMarkdown: `# 簽呈單 (AP) 欄位設計

本表單用於一般事務之簽核與核定，支援涉及外部合作廠商時之動態欄位擴充與 AML/公司資訊自動帶入。

| 欄位 ID | 欄位名稱 | 欄位型態 | 必填 | 說明/動態顯示條件 |
| :--- | :--- | :--- | :--- | :--- |
| **subject** | 主旨 | 單行文字 | 是 | 請簡述簽呈之主旨與主要目的 |
| **description** | 內容說明 | 多行文字 | 是 | 詳細說明本簽呈之原因、內容與背景 |
| **attachment** | 附件上傳 | 單行文字 | 否 | 請貼上相關雲端連結或資料夾路徑 |
| **external_collab** | 是否涉及外部合作廠商 | 下拉選單 | 是 | 可選擇「是」或「否」 |
| **ext_tax_id** | 統一編號/識別碼 | 單行文字 | 是 | 當「是否涉及外部合作廠商」選擇「是」時顯示，輸入後自動帶入廠商與負責人資料 |
| **ext_company_name** | 廠商名稱/公司名稱 | 單行文字 | 是 | 當「是否涉及外部合作廠商」選擇「是」時顯示，自動由 API 帶入，可手動修改 |
| **ext_company_owner** | 負責人姓名 | 單行文字 | 是 | 當「是否涉及外部合作廠商」選擇「是」時顯示，自動由 API 帶入，可手動修改 |`,
        logicMarkdown: `# 簽呈單 (AP) 簽核邏輯矩陣

根據簽件屬性，系統將自動分派至對應的簽核層級。本表單支援動態 AML 調查關卡。

\`\`\`mermaid
graph TD
    Start([1. 申請人送出]) --> Stage1[2. 直屬主管簽核]
    Stage1 --> Stage2[3. 本部部長簽核]
    Stage2 --> Cond{涉及外部合作廠商?}
    Cond -- 是 (且需進行 AML 調查) --> Stage3[4. AML調查與法遵審查]
    Cond -- 否 --> Stage4[5. 行政副總核決]
    Stage3 --> Stage4
    Stage4 --> Stage5[6. 總經理終審]
    Stage5 --> End([簽核完成並歸檔])
\`\`\`

### 簽核關卡明細

| 關卡 | 簽核角色 | 觸發條件 | 說明 |
| :--- | :--- | :--- | :--- |
| **第 1 關** | 直屬主管 (MANAGER) | 無條件 | 申請人之直接匯報主管第一階段審查 |
| **第 2 關** | 部門經理/部長 (DEPT_HEAD) | 無條件 | 部門一級主管之複審與核可 |
| **第 3 關** | AML 調查與法遵審查 (SPECIAL:AML_CHECK / ADMIN_DIRECTOR) | **external_collab == '是'** | 外部廠商統一編號自動觸發 AML/黑名單比對與法遵主管簽核 |
| **第 4 關** | 行政副總 (ADMIN_VP) | 無條件 | 管理本部最高主管審查 |
| **第 5 關** | 總經理 (GM) | 無條件 | 終審與最高核決 |`,
        configJSON: {
          fields: [
            { id: "subject", label: "主旨", type: "text", required: true },
            { id: "description", label: "內容說明", type: "textarea", required: true },
            { id: "attachment", label: "附件上傳 (請貼上雲端連結)", type: "text", required: false },
            { id: "external_collab", label: "是否涉及外部合作廠商", type: "select", options: ["否", "是"], required: true },
            { id: "ext_tax_id", label: "統一編號/識別碼", type: "text", required: true, showIf: { field: "external_collab", value: "是" } },
            { id: "ext_company_name", label: "廠商名稱/公司名稱", type: "text", required: true, showIf: { field: "external_collab", value: "是" } },
            { id: "ext_company_owner", label: "負責人姓名", type: "text", required: true, showIf: { field: "external_collab", value: "是" } }
          ]
        }
      },
      {
        formId: 'RD',
        fieldsMarkdown: `# 請款單 (RD) 欄位設計

本表單供各部門進行請款與核銷作業，整合外部合作廠商之 AML 調查與統一編號快速帶入。

| 欄位 ID | 欄位名稱 | 欄位型態 | 必填 | 說明/動態顯示條件 |
| :--- | :--- | :--- | :--- | :--- |
| **related_ticket** | 相關單號 | 單行文字 | 否 | 搭配請/採購單號使用，便於勾稽 |
| **expense_category** | 支出科目 | 單行文字 | 是 | 例如：差旅費、廣告費、郵電費等 |
| **amount** | 請款金額 | 數值 | 是 | 本次請款之實際新台幣金額 |
| **external_collab** | 是否涉及外部合作廠商 | 下拉選單 | 是 | 可選擇「是」或「否」 |
| **vendor_name** | 廠商名稱 | 單行文字 | 是 | 當「是否涉及外部合作廠商」為「否」時顯示 |
| **ext_tax_id** | 統一編號/識別碼 | 單行文字 | 是 | 當「是否涉及外部合作廠商」為「是」時顯示，輸入後自動帶入廠商與負責人資料 |
| **ext_company_name** | 廠商名稱/公司名稱 | 單行文字 | 是 | 當「是否涉及外部合作廠商」為「是」時顯示，自動由 API 帶入，可手動修改 |
| **ext_company_owner** | 負責人姓名 | 單行文字 | 是 | 當「是否涉及外部合作廠商」為「是」時顯示，自動由 API 帶入，可手動修改 |
| **payment_date** | 付款期限 | 日期 | 是 | 預計付款之日期 |
| **payment_method** | 付款方式 | 下拉選單 | 是 | 可選擇「匯款」、「現金」或「已由申請人代墊」 |
| **description** | 請款用途說明 | 多行文字 | 是 | 詳細說明本次請款之用途與明細 |
| **attachment** | 檢附單據 | 單行文字 | 是 | 請貼上發票、收據或相關憑證之雲端/共享資料夾連結 |`,
        logicMarkdown: `# 請款單 (RD) 簽核邏輯矩陣

請款單簽核依據請款金額實施分級授權。金額大於新台幣 5,000 元時將自動加會高階主管。

\`\`\`mermaid
graph TD
    Start([1. 申請人送出]) --> Stage1[2. 直屬主管簽核]
    Stage1 --> Stage2[3. 本部部長簽核]
    Stage2 --> Cond{請款金額 > 5,000 元?}
    Cond -- 是 --> Stage3[4. 行政副總審核]
    Stage3 --> Stage4[5. 總經理核決]
    Stage4 --> End([簽核完成並撥款])
    Cond -- 否 --> End
\`\`\`

### 簽核關卡明細

| 關卡 | 簽核角色 | 觸發條件 | 說明 |
| :--- | :--- | :--- | :--- |
| **第 1 關** | 直屬主管 (MANAGER) | 無條件 | 申請人之直屬主管進行初步預算與合理性審查 |
| **第 2 關** | 部門經理/部長 (DEPT_HEAD) | 無條件 | 部門一級主管之複審與額度確認 |
| **第 3 關** | 行政副總 (ADMIN_VP) | **amount > 5000** | 金額超過 5,000 元時加會行政副總進行公司級審查 |
| **第 4 關** | 總經理 (GM) | **amount > 5000** | 金額超過 5,000 元時需經總經理最終核准 |`,
        configJSON: {
          fields: [
            { id: "related_ticket", label: "相關單號 (搭配請/採購單號)", type: "text", required: false },
            { id: "expense_category", label: "支出科目", type: "text", required: true },
            { id: "amount", label: "請款金額", type: "number", required: true },
            { id: "external_collab", label: "是否涉及外部合作廠商", type: "select", options: ["否", "是"], required: true },
            { id: "vendor_name", label: "廠商名稱", type: "text", required: true, showIf: { field: "external_collab", value: "否" } },
            { id: "ext_tax_id", label: "統一編號/識別碼", type: "text", required: true, showIf: { field: "external_collab", value: "是" } },
            { id: "ext_company_name", label: "廠商名稱/公司名稱", type: "text", required: true, showIf: { field: "external_collab", value: "是" } },
            { id: "ext_company_owner", label: "負責人姓名", type: "text", required: true, showIf: { field: "external_collab", value: "是" } },
            { id: "payment_date", label: "付款期限", type: "date", required: true },
            { id: "payment_method", label: "付款方式", type: "select", options: ["匯款", "現金", "已由申請人代墊"], required: true },
            { id: "description", label: "請款用途說明", type: "textarea", required: true },
            { id: "attachment", label: "檢附單據 (請貼上雲端/資料夾連結)", type: "text", required: true }
          ]
        }
      },
      {
        formId: 'CS',
        fieldsMarkdown: `# 用印申請單 (CS) 欄位設計

本表單用於公司各類印信（如經濟部章、大章、小章、法務章、發票章等）之使用申請與管制登記。

| 欄位 ID | 欄位名稱 | 欄位型態 | 必填 | 說明/動態顯示條件 |
| :--- | :--- | :--- | :--- | :--- |
| **related_ticket** | 相關單號 | 單行文字 | 否 | 搭配請/採購單號或合約單號，便於後續核對 |
| **seal_type** | 用印類別 | 下拉選單 | 是 | 可選擇：「經濟部章」、「銀行用章」、「法務章」、「發票章」、「合約便章」 |
| **description** | 用印文件說明 | 多行文字 | 是 | 請詳細說明本次用印之文件名稱、用途與份數 |
| **attachment** | 用印文件草稿 | 單行文字 | 是 | 請貼上待用印文件草稿之雲端連結以供審核 |`,
        logicMarkdown: `# 用印申請單 (CS) 簽核邏輯矩陣

用印簽核依據印信種類之重要性進行分級簽核。重大印信（非發票章）均需經高階主管與印信管理人核放。

\`\`\`mermaid
graph TD
    Start([1. 申請人送出]) --> CondLegal{是否為合約便章?}
    CondLegal -- 是 --> StageLegal[2. 法務審查]
    CondLegal -- 否 --> StageManager[3. 直屬主管簽核]
    StageLegal --> StageManager
    StageManager --> StageDept[4. 本部部長簽核]
    StageDept --> CondBig{是否為發票章?}
    CondBig -- 否 (經濟部章/銀行用章/法務章/合約便章) --> StageVP[5. 行政副總審核]
    StageVP --> StageGM[6. 總經理核決]
    StageGM --> StageBig[7. 大章管理人蓋章]
    StageBig --> StageSmall[8. 小章管理人蓋章]
    StageSmall --> End([完成用印並歸檔])
    CondBig -- 是 (發票章由部門內控直接提早結案) --> End
\`\`\`

### 簽核關卡明細

| 關卡 | 簽核角色 | 觸發條件 | 說明 |
| :--- | :--- | :--- | :--- |
| **第 1 關** | 法務處 (ROLE:LEGAL) | **seal_type == '合約便章'** | 合約類文件需由法務處進行合約條款與合規性首簽審查 |
| **第 2 關** | 直屬主管 (MANAGER) | 無條件 | 申請人之直接主管初步審查用印合理性 |
| **第 3 關** | 部門經理/部長 (DEPT_HEAD) | 無條件 | 部門一級主管複審 |
| **第 4 關** | 行政副總 (ADMIN_VP) | **seal_type != '發票章'** | 重大印信用印需經管理本部最高主管核准 |
| **第 5 關** | 總經理 (GM) | **seal_type != '發票章'** | 重大印信用印需經總經理最終核准 |
| **第 6 關** | 大章管理人 (ROLE:BIG_SEAL_MGR) | **seal_type != '發票章'** | 大章專責保管人員執行用印操作與登記 |
| **第 7 關** | 小章管理人 (ROLE:SMALL_SEAL_MGR) | **seal_type != '發票章'** | 小章專責保管人員執行用印操作與登記 |`,
        configJSON: {
          fields: [
            { id: "related_ticket", label: "相關單號 (搭配請/採購單號)", type: "text", required: false },
            { id: "seal_type", label: "用印類別", type: "select", options: ["經濟部章", "銀行用章", "法務章", "發票章", "合約便章"], required: true },
            { id: "description", label: "用印文件說明", type: "textarea", required: true },
            { id: "attachment", label: "用印文件草稿 (請貼上雲端連結)", type: "text", required: true }
          ]
        }
      }
    ];

    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.json({ definitions: localDefinitions });
    }

    try {
      const response = await fetch(`${scriptUrl}?action=getData&sheet=FormDefinitions`);
      const data = await response.json();
      const rows = data.data || [];
      const fetchedDefinitions = rows.slice(1).map((r: any) => {
        const formId = r[0];
        const configJSON = r[3] ? JSON.parse(r[3]) : null;
        return {
          formId,
          fieldsMarkdown: r[1],
          logicMarkdown: r[2],
          configJSON
        };
      });

      // Merge and override fetched definitions with our latest local ones
      const merged = fetchedDefinitions.map((def: any) => {
        const local = localDefinitions.find(l => l.formId === def.formId);
        if (local) {
          return {
            ...def,
            fieldsMarkdown: (def.fieldsMarkdown && def.fieldsMarkdown.trim()) ? def.fieldsMarkdown : local.fieldsMarkdown,
            logicMarkdown: (def.logicMarkdown && def.logicMarkdown.trim()) ? def.logicMarkdown : local.logicMarkdown,
            configJSON: local.configJSON
          };
        }
        return def;
      });

      // Append local definitions if not fetched
      localDefinitions.forEach(local => {
        if (!merged.some((m: any) => m.formId === local.formId)) {
          merged.push(local);
        }
      });

      res.json({ definitions: merged });
    } catch (error) {
      console.error("Error fetching form definitions:", error);
      res.json({ definitions: localDefinitions });
    }
  });

  app.post("/api/form-definitions/:formId", authMiddleware, async (req, res): Promise<any> => {
    const { formId } = req.params;
    const { fieldsMarkdown, logicMarkdown, configJSON } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.status(500).json({ error: "GAS URL not configured" });

    try {
      // 1. Save to FormDefinitions sheet
      const payload = {
        action: 'saveData',
        sheet: 'FormDefinitions',
        matchColumn: 1, // FormID
        matchValue: formId,
        row: [formId, fieldsMarkdown, logicMarkdown, JSON.stringify(configJSON)]
      };
      
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving form definition:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/rules/:formType", authMiddleware, async (req, res): Promise<any> => {
    const { formType } = req.params;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.json({ rules: [] });
    }

    try {
      const response = await fetch(`${scriptUrl}?action=getRules&formType=${formType}`);
      const data = await response.json();
      const rows = data.data || [];
      const rules = rows.slice(1).map((r: any) => ({
        id: r[0],
        stage: Number(r[2]),
        conditionField: r[3] || '',
        conditionOp: r[4] || '',
        conditionVal: r[5] || '',
        approverType: r[6] || 'HIERARCHY',
        approverValue: r[7] || ''
      }));
      // Sort by stage
      rules.sort((a: any, b: any) => a.stage - b.stage);
      res.json({ rules });
    } catch (error) {
      console.error("Error fetching rules:", error);
      res.status(500).json({ error: "Failed to fetch rules" });
    }
  });

  app.post("/api/rules/:formType", authMiddleware, async (req, res): Promise<any> => {
    const { formType } = req.params;
    const { rules } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true });

    try {
      const rows = rules.map((r: any) => [
        r.id,
        formType,
        r.stage,
        r.conditionField,
        r.conditionOp,
        r.conditionVal,
        r.approverType,
        r.approverValue
      ]);

      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveRules', formType, rows })
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving rules:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // 2. Submit Application Form to Google Sheets via Apps Script
  // ============================================================================
  app.post("/api/submit-approval", authMiddleware, async (req, res): Promise<any> => {
    try {
      const { applicantEmail, applicantName, department, tickets } = req.body;
      const firstTicket = tickets?.[0];
      if (!firstTicket) return res.status(400).json({ error: "Missing ticket payload" });

      const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
      if (!scriptUrl) {
        const mockId = `${firstTicket.formType || 'AP'}${extractDeptCode(department)}${new Date().toISOString().slice(0, 10).replace(/-/g, '')}001`;
        return res.json({ success: true, generatedIds: [mockId], applicationNumber: mockId, source: 'mock' });
      }

      const result = await postToAppsScript(scriptUrl, {
        action: 'submitApplication',
        applicantEmail,
        applicantName,
        department,
        formType: firstTicket.formType,
        subject: firstTicket.subject || '',
        amount: firstTicket.amount || '',
        formData: firstTicket.formData || {}
      });

      return res.json({
        success: true,
        generatedIds: [result.applicationNumber],
        applicationNumber: result.applicationNumber,
        amlStatus: result.amlStatus
      });
    } catch (error: any) {
      console.error("Error submitting application:", error);
      return res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  // Legacy route body kept below for reference. The handler above returns first.
  /*
  // ============================================================================
  // 2. Submit Approval Form to Google Sheets via Apps Script
  // ============================================================================
  app.post("/api/submit-approval", authMiddleware, async (req, res): Promise<any> => {
    try {
      const { applicantEmail, applicantName, department, tickets } = req.body;
      const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

      if (!scriptUrl) {
        console.warn("GOOGLE_APPS_SCRIPT_URL is not set. Skipping actual Google Sheets insertion.");
        return res.json({ success: true, message: "Mock submission successful" });
      }

      // Fetch dynamic rules and users to determine the real first stage path
      const [rulesRes, usersRes] = await Promise.all([
        fetch(`${scriptUrl}?action=getData&sheet=WorkflowRules`),
        fetch(`${scriptUrl}?action=getData&sheet=Users`)
      ]);
      const rulesData = await rulesRes.json();
      const usersData = await usersRes.json();
      
      const allRules = rulesData.data || [];
      const allUsers = usersData.data || [];

      // Prepare data for Google Sheets based on the schema
      const rows = tickets.map((t: any) => {
        const { id, formType, formData, subject, amount } = t;

        const createdAt = new Date();
        const slaDeadline = new Date(createdAt.getTime() + 60 * 24 * 60 * 60 * 1000); // 60天作廢死線

        // 使用動態規則引擎，決定第一關的簽核者 (currentStage 傳入 0 代表從頭開始評估下一關 = 1)
        const next = evaluateDynamicRules(allRules, 0, formData, formType, applicantEmail, allUsers);

        return [
          id,                                // A: 單號 (TicketID)
          createdAt.toISOString(),           // B: 建立時間 (CreatedAt)
          applicantEmail,                    // C: 申請人信箱 (ApplicantEmail)
          applicantName,                     // D: 申請人姓名 (ApplicantName)
          department,                        // E: 所屬部門 (Department)
          formType,                          // F: 表單類型 (FormType)
          "Pending",                         // G: 狀態 (Status)
          next.stage.toString(),             // H: 目前關卡 (CurrentStage)
          slaDeadline.toISOString(),         // I: 作廢死線 (SLA_Deadline)
          subject || '',                     // J: 主旨/事由 (Subject)
          amount || '',                      // K: 金額 (Amount)
          "FALSE",                           // L: 需AML查核 (Legacy, keep string for now)
          JSON.stringify(formData),          // M: 完整動態資料 (FormData JSON)
          next.approver                      // N: 目前簽核者 (CurrentApprover)
        ];
      });

      // Call the Google Apps Script Web App (POST request)
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ action: 'submitTickets', rows: rows }),
      });

      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        console.error("Apps Script returned HTML instead of JSON. Script is likely missing doPost(e), or threw an unhandled exception.");
        console.error("Response snippet:", responseText.substring(0, 200));
        throw new Error(`Apps Script responded with invalid JSON (HTML). 
這通常代表幾種情況：
1. 您的 Google Apps Script 程式碼中忘記加入 \`doPost(e)\` 函數，或是裡面執行發生錯誤。
2. 部署權限設定錯誤 (必須設定為「存取權限: 所有人 (Anyone)」)。
3. 未將最新版本的 Apps Script 重新發布 (請點擊「部署 > 管理部署作業 > 編輯 > 建立新版本」)。
請檢查您的 Apps Script 後台。`);
      }

      if (!response.ok) throw new Error(`Apps Script returned status: ${response.status}`);
      if (!result.success) throw new Error(result.error || "Unknown error from Apps Script");

      const generatedIds = result.generatedIds || tickets.map((t: any) => t.id);
      res.json({ success: true, generatedIds });
    } catch (error: any) {
      console.error("Error submitting to Apps Script:", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });
  */

  // 3. Fetch Pending Tickets for an Approver
  app.get("/api/tickets/pending/:email", authMiddleware, async (req, res): Promise<any> => {
    const email = req.params.email.toLowerCase();
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    // Demo tickets for testing the UI
    const mockTickets = [
      { id: 'DEMO-AP-001', createdAt: new Date().toISOString(), applicantEmail: 'test@company.com', applicantName: '陳小明 (展示用)', dept: 'MK (行銷企劃部)', formType: 'AP', subject: '行銷合作專案簽呈', amount: '', status: 'Pending', stage: '1' }
    ];

    if (!scriptUrl) {
      return res.json({ tickets: mockTickets, source: 'mock' });
    }

    try {
      // 1. 取得使用者的系統角色 (例如 ROLE:FINANCE)
      const usersRes = await fetch(`${scriptUrl}?action=getData&sheet=Users`);
      const usersData = await usersRes.json();
      const myRow = (usersData.data || []).find((r: any) => r[0]?.toLowerCase() === email);
      // 假設 E 欄 (index 4) 存放角色，例如 "ROLE:FINANCE,ROLE:GM"
      const myRolesStr = String(myRow && myRow[4] ? myRow[4] : '');
      const myRoles = myRolesStr ? myRolesStr.split(',').map((r:string)=>r.trim()) : [];

      // 2. 取得所有單據與規則
      const [ticketsRes, rulesRes] = await Promise.all([
        fetch(`${scriptUrl}?action=getData&sheet=Tickets`),
        fetch(`${scriptUrl}?action=getData&sheet=WorkflowRules`)
      ]);
      const ticketsData = await ticketsRes.json();
      const rulesData = await rulesRes.json();
      
      const ticketsRows = ticketsData.data || [];
      const allRules = rulesData.data || [];

      // 3. 過濾單據：狀態為 Pending，且 CurrentApprover 是我的信箱，或是我的角色
      const pendingTickets = ticketsRows.slice(1).filter((row: any) => {
        const tStatus = row[6];
        const tApprover = row[13]; // N欄: CurrentApprover
        
        if (tStatus !== 'Pending') return false;
        
        const isMyTurn = (tApprover?.toLowerCase() === email) || myRoles.includes(tApprover);
        return isMyTurn;
      }).map((row: any) => {
        const tFormType = row[5];
        const tStage = Number(row[7]);
        
        // Find rule for this stage to know if it's special
        const stageRule = allRules.find((r:any) => r[1] === tFormType && Number(r[2]) === tStage);
        const approverType = stageRule ? stageRule[6] : '';
        
        return {
          id: row[0],
          createdAt: row[1],
          applicantEmail: row[2],
          applicantName: row[3],
          dept: row[4],
          formType: tFormType,
          status: row[6],
          stage: tStage,
          subject: row[9],
          amount: row[10],
          formData: row[12] ? JSON.parse(row[12]) : {},
          approverType
        };
      });

      if (pendingTickets.length === 0) {
        return res.json({ tickets: mockTickets, source: 'demo_mock' });
      }

      res.json({ tickets: pendingTickets, source: 'sheets' });
    } catch (error) {
      console.error("Error fetching tickets:", error);
      res.json({ tickets: mockTickets, source: 'mock_error' });
    }
  });

  // ============================================================================
  // ruleEngine.js (Dynamic Rule Engine Evaluator)
  // ============================================================================
  const evaluateDynamicRules = (rules: any[], currentStage: number, formData: any, formType: string, applicantEmail: string, usersData: any[]): { stage: number | 'END', approver: string } => {
    
    // Sort rules by stage
    const formRules = rules.filter(r => r[1] === formType && Number(r[2]) > currentStage).sort((a, b) => Number(a[2]) - Number(b[2]));
    
    if (formRules.length === 0) return { stage: 'END', approver: '' };

    // Group rules by stage
    const stages = [...new Set(formRules.map(r => Number(r[2])))];

    for (const stage of stages) {
      const stageRules = formRules.filter(r => Number(r[2]) === stage);
      
      for (const rule of stageRules) {
        const conditionField = rule[3];
        const conditionOp = rule[4];
        const conditionVal = rule[5];
        const approverType = rule[6];
        const approverValue = rule[7];

        let isMatch = false;

        // Condition Check
        if (conditionField === 'ALWAYS' && String(conditionOp).toUpperCase() === 'TRUE') {
          isMatch = true;
        } else {
          // Dynamic evaluation
          let actualVal = formData[conditionField];
          
          if (conditionOp === '>') isMatch = Number(actualVal) > Number(conditionVal);
          else if (conditionOp === '==') isMatch = String(actualVal) === String(conditionVal);
          else if (conditionOp === 'IN') {
            const allowed = conditionVal.split(',').map((s:string) => s.trim());
            isMatch = allowed.includes(actualVal);
          }
        }

        if (isMatch) {
          let assignedApprover = '';
          const applicantRow = usersData.find(u => u[0]?.toLowerCase() === applicantEmail.toLowerCase());
          
          if (approverType === 'MANAGER') {
            assignedApprover = applicantRow ? applicantRow[3] : ''; // ManagerEmail
          } else if (approverType === 'ROLE') {
            assignedApprover = String(approverValue);
          } else {
            assignedApprover = String(approverValue); // Direct email fallback
          }

          // ===== SKIP LOGIC (跳關處理) =====
          // 1. 若設定為直屬主管，但申請人就是直屬主管自己？ => 那就跳過這關
          // 2. 若設定找 ROLE:DEPT_HEAD，但申請人剛好擁有 ROLE:DEPT_HEAD？ => 也跳過
          if (assignedApprover) {
            let shouldSkip = false;
            
            // 如果這關的主管信箱跟申請人信箱完全一樣 (校長兼撞鐘)，跳過
            if (approverType === 'MANAGER' && assignedApprover.toLowerCase() === applicantEmail.toLowerCase()) {
              shouldSkip = true;
            }
            
            // 跳過角色：如果我是這個簽核角色 (比如我自己就是部長)，且關卡也是要求這個角色，跳過
            if (approverType === 'ROLE' && applicantRow) {
              const myRoles = String(applicantRow[4] || '').split(',').map(s=>s.trim());
              if (myRoles.includes(assignedApprover)) {
                shouldSkip = true;
              }
            }

            if (shouldSkip) {
              // 此規則匹配了，但由於跳關規則，我們需要直接嘗試下一個 Stage，所以 Break 當前 Stage 的 Rule Loop
              break; 
            }
          }

          return { stage: Number(stage), approver: assignedApprover };
        }
      }
      // If we looked at all rules for this stage and didn't return, we try the next stage
    }

    return { stage: 'END', approver: '' };
  };

  // 4. Approve/Reject Ticket (Dynamic Rule Engine Integration)
  app.post("/api/tickets/:ticketId/action", authMiddleware, async (req, res): Promise<any> => {
    const { ticketId } = req.params;
    const { action, approverEmail, comment, formDataUpdates } = req.body; // action: 'approve' | 'reject'
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    if (ticketId.startsWith('DEMO-')) {
      await new Promise(resolve => setTimeout(resolve, 800));
      return res.json({ success: true, message: "Demo action successful" });
    }

    if (!scriptUrl) {
      return res.json({ success: true, message: "Mock action successful" });
    }

    try {
      // 必須先取得這張單的資料，才能跑規則引擎
      const [ticketsRes, rulesRes, usersRes] = await Promise.all([
        fetch(`${scriptUrl}?action=getData&sheet=Tickets`),
        fetch(`${scriptUrl}?action=getData&sheet=WorkflowRules`),
        fetch(`${scriptUrl}?action=getData&sheet=Users`)
      ]);
      const ticketsData = await ticketsRes.json();
      const rulesData = await rulesRes.json();
      const usersData = await usersRes.json();
      
      const ticketRow = (ticketsData.data || []).find((r:any) => r[0] === ticketId);
      if (!ticketRow) throw new Error("Ticket not found");

      const formType = ticketRow[5];
      const currentStage = Number(ticketRow[7]);
      const formData = JSON.parse(ticketRow[12] || '{}');
      const applicantEmail = ticketRow[2];
      
      if (formDataUpdates && typeof formDataUpdates === 'object') {
        Object.assign(formData, formDataUpdates);
      }

      const allRules = rulesData.data || [];
      const currentRule = allRules.find((r:any) => r[1] === formType && Number(r[2]) === currentStage);
      const approverType = currentRule ? currentRule[6] : '';

      // Server-side validation for AML Check
      if (action === 'approve' && approverType === 'SPECIAL:AML_CHECK') {
        if (formData.aml_result === '不正常' || formData.rp_result === '關係人交易但未經過董事會同意') {
          return res.status(400).json({ error: "此單據未通過 AML 或關係人交易審查，只能進行駁回操作。" });
        }
      }

      let newStatus = 'Pending';
      let newStage: string | number = currentStage;
      let newApprover = '';

      if (action === 'reject') {
        // 駁回重啟：直接退回發起人信箱
        newStatus = 'Rejected'; 
        newStage = 1;
        newApprover = applicantEmail;
      } else {
        // 核准：【使用動態規則引擎決定下一關】
        const allUsers = usersData.data || [];
        
        // Dynamic Rule Evaluation with skip logic included
        const next = evaluateDynamicRules(allRules, currentStage, formData, formType, applicantEmail, allUsers);
        
        if (next.stage === 'END') {
          newStatus = 'Approved';
          newStage = currentStage;
          newApprover = '';
        } else {
          newStatus = 'Pending';
          newStage = next.stage;
          newApprover = next.approver;
        }
      }

      // 呼叫 Apps Script 更新
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateTicket',
          ticketId,
          status: newStatus,
          stage: newStage,
          nextApprover: newApprover,
          approverEmail,
          actionType: action,
          comment,
          formData: formDataUpdates ? formData : undefined // Only send if updated
        })
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      
      res.json({ success: true, newStatus, newStage, newApprover });
    } catch (error: any) {
      console.error("Error updating ticket:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // 4.5 Resubmit Ticket
  app.post("/api/tickets/:ticketId/resubmit", authMiddleware, async (req, res): Promise<any> => {
    const { ticketId } = req.params;
    const { applicantEmail, formData, amount, subject } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    if (ticketId.startsWith('DEMO-')) {
      await new Promise(resolve => setTimeout(resolve, 800));
      return res.json({ success: true, message: "Demo resubmit successful" });
    }

    if (!scriptUrl) {
      return res.json({ success: true, message: "Mock resubmit successful" });
    }

    try {
      const [ticketsRes, rulesRes, usersRes] = await Promise.all([
        fetch(`${scriptUrl}?action=getData&sheet=Tickets`),
        fetch(`${scriptUrl}?action=getData&sheet=WorkflowRules`),
        fetch(`${scriptUrl}?action=getData&sheet=Users`)
      ]);
      const ticketsData = await ticketsRes.json();
      const rulesData = await rulesRes.json();
      const usersData = await usersRes.json();
      
      const ticketRow = (ticketsData.data || []).find((r:any) => r[0] === ticketId);
      if (!ticketRow) throw new Error("Ticket not found");

      const formType = ticketRow[5];

      // Re-evaluate rules from stage 0
      const allRules = rulesData.data || [];
      const allUsers = usersData.data || [];
      
      const next = evaluateDynamicRules(allRules, 0, formData, formType, applicantEmail, allUsers);
      
      let newStatus = 'Pending';
      let newStage: string | number = next.stage;
      let newApprover = next.approver;

      if (next.stage === 'END') {
        newStatus = 'Approved';
        newStage = 'END';
        newApprover = '';
      }

      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resubmitTicket',
          ticketId,
          status: newStatus,
          stage: newStage,
          nextApprover: newApprover,
          subject,
          amount,
          formData,
          approverEmail: applicantEmail
        })
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      
      res.json({ success: true, newStatus, newStage, newApprover });
    } catch (error: any) {
      console.error("Error resubmitting ticket:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // 5. Fetch My Own Submitted Tickets
  app.get("/api/tickets/my/:email", authMiddleware, async (req, res): Promise<any> => {
    const email = req.params.email.toLowerCase();
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    // Demo tickets for testing the UI
    const mockTickets = [
      { id: 'DEMO-AP-001', createdAt: new Date().toISOString(), applicantEmail: email, applicantName: '展示測試員', dept: '測試部門', formType: 'AP', subject: '行銷合作專案簽呈', amount: '', status: 'Pending', stage: '1', currentApprover: '林主管 - 行銷部', formData: { apSubject: '行銷合作專案簽呈', apDesc: '說明內容', external_collab: 'true', ext_company_name: '外部測試公司' } },
      { id: 'DEMO-CS-002', createdAt: new Date(Date.now() - 86400000).toISOString(), applicantEmail: email, applicantName: '展示測試員', dept: '測試部門', formType: 'CS', subject: '經濟部變更登記用印', amount: '', status: 'Approved', stage: 'END', currentApprover: '', formData: { seal_type: '經濟部章', cs_desc: '需要用印' } }
    ];

    if (!scriptUrl) {
      return res.json({ tickets: [mockTickets[0], mockTickets[1]], source: 'mock' });
    }

    try {
      // 取得所有單據與使用者資料 (以利於轉換 Approver 顯示名稱)
      const [ticketsRes, usersRes] = await Promise.all([
        fetch(`${scriptUrl}?action=getData&sheet=Tickets`),
        fetch(`${scriptUrl}?action=getData&sheet=Users`)
      ]);
      const ticketsData = await ticketsRes.json();
      const usersData = await usersRes.json();
      
      const rows = ticketsData.data || [];
      const users = usersData.data || [];

      // 轉換 Approver 字串為友善名稱的 Helper
      const getApproverDisplayName = (approverStr: string) => {
        if (!approverStr) return '';
        if (approverStr.startsWith('ROLE:')) {
          const roleMap: Record<string, string> = {
            'ROLE:ADMIN': '系統管理員',
            'ROLE:FINANCE': '財務部主管',
            'ROLE:GM': '總經理',
            'ROLE:LEGAL': '法務部主管',
            'ROLE:CS_HEAD': '客服部主管'
          };
          return roleMap[approverStr] || approverStr;
        }
        // 如果是 Email，去 Users 表找他的名字與部門
        const userRow = users.find((u: any) => u[0]?.toLowerCase() === approverStr.toLowerCase());
        if (userRow && userRow[1]) {
          const name = String(userRow[1]).split('(')[0].trim(); // 拿中文名
          const dept = userRow[2]; // 部門代號或名稱
          return `${name} - ${dept}`;
        }
        return approverStr; // 找不到就 fallback 顯示 Email
      };
      
      const myTickets = rows.slice(1).filter((r: any) => {
        // C欄 (index 2) 是 ApplicantEmail
        return r[2]?.toLowerCase() === email;
      }).map((r: any) => ({
        id: r[0],
        createdAt: r[1],
        applicantEmail: r[2],
        applicantName: r[3],
        dept: r[4],
        formType: r[5],
        status: r[6],
        stage: r[7],
        subject: r[9],
        amount: r[10],
        formData: r[12] ? JSON.parse(r[12]) : {},
        currentApprover: getApproverDisplayName(r[13] || '')
      }));

      // Sort by createdAt descending
      myTickets.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json({ tickets: myTickets });
    } catch (error) {
      console.error("Error fetching my tickets:", error);
      res.status(500).json({ error: "Failed to fetch my tickets" });
    }
  });

  // 6. Fetch Ticket Audit Logs
  app.get("/api/tickets/:ticketId/logs", authMiddleware, async (req, res): Promise<any> => {
    const { ticketId } = req.params;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    if (!scriptUrl || ticketId.startsWith('DEMO-')) {
      return res.json({ logs: [
        { ticketId, action: 'Submitted', approver: 'applicant@company.com', stage: '0', comment: '發起申請', timestamp: new Date(Date.now() - 86400000).toISOString() },
        { ticketId, action: 'Approved', approver: 'boss@company.com', stage: '1', comment: '同意', timestamp: new Date(Date.now() - 3600000).toISOString() }
      ]});
    }

    try {
      const response = await fetch(`${scriptUrl}?action=getAuditLogs&ticketId=${ticketId}`);
      const data = await response.json();
      res.json({ logs: data.data || [] });
    } catch (error) {
      console.error("Error fetching logs", error);
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  app.get("/api/backoffice/tickets", authMiddleware, async (req, res): Promise<any> => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    const roles = req.user?.roles || [];
    const canViewBackoffice = roles.some((role) => [
      'ROLE:ADMIN',
      'ROLE:ADMIN_HEAD',
      'ROLE:ADMIN_DIRECTOR',
      'ROLE:FINANCE',
      'ROLE:RISK',
      'ROLE:DEPT_HEAD',
      'ROLE:GM'
    ].includes(role));

    if (!canViewBackoffice) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!scriptUrl) {
      return res.json({ tickets: [], source: 'mock' });
    }

    try {
      const response = await fetch(`${scriptUrl}?action=getData&sheet=Tickets`);
      const data = await response.json();
      const rows = data.data || [];
      const tickets = rows.slice(1).map((row: any[]) => ({
        id: row[0],
        createdAt: row[1],
        applicantEmail: row[2],
        applicantName: row[3],
        dept: row[4],
        formType: row[5],
        status: row[6],
        subject: row[9],
        amount: row[10],
        formData: parseJsonCell(row[12]),
        currentApprover: row[13] || ''
      })).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json({ tickets });
    } catch (error: any) {
      console.error("Error fetching backoffice tickets:", error);
      res.status(500).json({ error: error.message || "Failed to fetch backoffice tickets" });
    }
  });

  app.post("/api/tickets/:ticketId/complete", authMiddleware, async (req, res): Promise<any> => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true, source: 'mock' });

    try {
      const result = await postToAppsScript(scriptUrl, {
        action: 'completeTicket',
        ticketId: req.params.ticketId,
        completedBy: req.user?.email,
        note: req.body?.note || ''
      });
      res.json(result);
    } catch (error: any) {
      console.error("Error completing ticket:", error);
      res.status(500).json({ error: error.message || "Failed to complete ticket" });
    }
  });

  app.get("/api/meeting-rooms", authMiddleware, async (req, res): Promise<any> => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.json({
        rooms: [
          { id: 'ROOM-5F', name: '5F會議室', location: '5F', capacity: '8', isActive: true, sortOrder: 1, openTime: '09:00', closeTime: '18:00' },
          { id: 'ROOM-11F', name: '11F會議室', location: '11F', capacity: '12', isActive: true, sortOrder: 2, openTime: '09:00', closeTime: '18:00' }
        ],
        source: 'mock'
      });
    }

    try {
      const response = await fetch(`${scriptUrl}?action=getData&sheet=MeetingRooms`);
      const data = await response.json();
      const rows = data.data || [];
      const rooms = rows.slice(1)
        .map(mapMeetingRoom)
        .filter((room: any) => room.id)
        .sort((a: any, b: any) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-Hant'));
      res.json({ rooms });
    } catch (error: any) {
      console.error("Error fetching meeting rooms:", error);
      res.status(500).json({ error: error.message || "Failed to fetch meeting rooms" });
    }
  });

  app.post("/api/meeting-rooms", authMiddleware, async (req, res): Promise<any> => {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    const now = new Date().toISOString();
    const roomId = String(req.body.id || `ROOM-${Date.now()}`).trim();
    const roomName = String(req.body.name || '').trim();
    if (!roomName) return res.status(400).json({ error: "會議室名稱必填" });

    if (!scriptUrl) return res.json({ success: true, source: 'mock' });

    try {
      const result = await postToAppsScript(scriptUrl, {
        action: 'saveMeetingRoom',
        room: {
          id: roomId,
          name: roomName,
          location: String(req.body.location || '').trim(),
          capacity: String(req.body.capacity || '').trim(),
          isActive: req.body.isActive !== false,
          sortOrder: String(req.body.sortOrder || ''),
          openTime: '09:00',
          closeTime: '18:00',
          createdAt: req.body.createdAt || now
        }
      });
      res.json(result);
    } catch (error: any) {
      console.error("Error saving meeting room:", error);
      res.status(500).json({ error: error.message || "Failed to save meeting room" });
    }
  });

  app.get("/api/meeting-bookings", authMiddleware, async (req, res): Promise<any> => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    const startDate = String(req.query.startDate || '');
    const endDate = String(req.query.endDate || '');
    const mineOnly = req.query.mine === 'true';

    if (!scriptUrl) return res.json({ bookings: [], source: 'mock' });

    try {
      const response = await fetch(`${scriptUrl}?action=getData&sheet=MeetingBookings`);
      const data = await response.json();
      const rows = data.data || [];
      const bookings = rows.slice(1)
        .map(mapMeetingBooking)
        .filter((booking: any) => booking.id)
        .filter((booking: any) => booking.status !== 'Cancelled')
        .filter((booking: any) => !startDate || booking.date >= startDate)
        .filter((booking: any) => !endDate || booking.date <= endDate)
        .filter((booking: any) => !mineOnly || String(booking.bookerEmail).toLowerCase() === req.user?.email.toLowerCase())
        .sort((a: any, b: any) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
      res.json({ bookings });
    } catch (error: any) {
      console.error("Error fetching meeting bookings:", error);
      res.status(500).json({ error: error.message || "Failed to fetch meeting bookings" });
    }
  });

  app.post("/api/meeting-bookings", authMiddleware, async (req, res): Promise<any> => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true, booking: { id: `MB${Date.now()}`, ...req.body }, source: 'mock' });

    try {
      const result = await postToAppsScript(scriptUrl, {
        action: 'createMeetingBooking',
        booking: {
          roomId: req.body.roomId,
          date: req.body.date,
          startTime: req.body.startTime,
          endTime: req.body.endTime,
          purpose: req.body.purpose,
          bookerEmail: req.user?.email,
          bookerName: req.user?.name,
          department: req.user?.dept
        }
      });
      res.json(result);
    } catch (error: any) {
      console.error("Error creating meeting booking:", error);
      res.status(500).json({ error: error.message || "Failed to create meeting booking" });
    }
  });

  app.post("/api/meeting-bookings/:bookingId/cancel", authMiddleware, async (req, res): Promise<any> => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true, source: 'mock' });

    try {
      const result = await postToAppsScript(scriptUrl, {
        action: 'cancelMeetingBooking',
        bookingId: req.params.bookingId,
        cancelledBy: req.user?.email,
        isAdmin: isAdminUser(req.user)
      });
      res.json(result);
    } catch (error: any) {
      console.error("Error cancelling meeting booking:", error);
      res.status(500).json({ error: error.message || "Failed to cancel meeting booking" });
    }
  });

  // ============================================================================
  // Vite Middleware for Development / Static Serving for Production
  // ============================================================================
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
