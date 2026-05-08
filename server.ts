import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

type SheetRow = any[];

type AuthUser = {
  email: string;
  name: string;
  dept: string;
  manager: string;
  roles: string[];
};

type CompliancePayload = {
  aml_result?: string;
  aml_comment?: string;
  rp_result?: string;
  rp_comment?: string;
};

const NOTICE_BOARD_KEY = "NoticeBoard";
const AML_SPECIAL_ROLE = "SPECIAL:AML_CHECK";

const DEMO_USERS: Record<string, AuthUser> = {
  "test@company.com": {
    email: "test@company.com",
    name: "陳小明 (Ming Chen)",
    dept: "MK (行銷企劃部)",
    manager: "boss@company.com",
    roles: ["ROLE:EMPLOYEE"],
  },
  "boss@company.com": {
    email: "boss@company.com",
    name: "李大方 (David Lee)",
    dept: "GM (總經理室)",
    manager: "boss@company.com",
    roles: ["ROLE:DEPT_HEAD", "ROLE:GM"],
  },
  "admin@company.com": {
    email: "admin@company.com",
    name: "王維運 (Admin)",
    dept: "IT (資訊處)",
    manager: "boss@company.com",
    roles: ["ROLE:ADMIN"],
  },
};

function parseRoles(value: unknown): string[] {
  return String(value || "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
}

function normalizeUserFromRow(row: SheetRow | undefined): AuthUser | null {
  if (!row || !row[0]) return null;
  return {
    email: String(row[0]).toLowerCase(),
    name: String(row[1] || ""),
    dept: String(row[2] || ""),
    manager: String(row[3] || ""),
    roles: parseRoles(row[4]),
  };
}

function createMockToken(user: AuthUser) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return Buffer.from(JSON.stringify({ ...user, expiresAt }), "utf8").toString("base64url");
}

function deriveDeptCode(department: string) {
  const match = department.match(/^([A-Za-z0-9]+)/);
  return (match?.[1] || "GEN").toUpperCase();
}

function buildTicketId(formType: string, department: string) {
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomSeq = Math.random().toString(36).slice(2, 6);
  return `${String(formType || "AP").toUpperCase()}${deriveDeptCode(department)}${yyyymmdd}${randomSeq}`;
}

function isAmlCheckStage(rules: SheetRow[], formType: string, stage: number) {
  return rules.some(
    (rule) =>
      rule[1] === formType && Number(rule[2]) === stage && String(rule[6] || "") === AML_SPECIAL_ROLE,
  );
}

function blocksApprovalByCompliance(compliance: CompliancePayload) {
  return (
    compliance.aml_result === "不正常" ||
    compliance.rp_result === "關係人交易但未經過董事會同意"
  );
}

function getNoticeBoardFallback() {
  return "";
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  app.post("/api/auth/login", async (req, res) => {
    const email = String(req.body?.email || "").toLowerCase().trim();
    if (!email || !email.includes("@")) {
      return res.status(400).json({ success: false, error: "Invalid email" });
    }

    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    if (!scriptUrl) {
      const mockUser = DEMO_USERS[email] || {
        email,
        name: "預設測試員 (Test Role)",
        dept: "CS (客服處)",
        manager: "",
        roles: ["ROLE:EMPLOYEE"],
      };
      return res.json({ success: true, token: createMockToken(mockUser), user: mockUser, expiresInDays: 7, source: "mock" });
    }

    try {
      const response = await fetch(`${scriptUrl}?action=getUser&email=${encodeURIComponent(email)}`);
      const data = await response.json();
      if (!response.ok || !data.success || !data.user) {
        return res.status(401).json({ success: false, error: data.error || "User not found" });
      }

      const user: AuthUser = {
        email,
        name: String(data.user.name || ""),
        dept: String(data.user.dept || ""),
        manager: String(data.user.manager || ""),
        roles: parseRoles(data.user.roles),
      };

      res.json({ success: true, token: createMockToken(user), user, expiresInDays: 7, source: "sheets" });
    } catch (error: any) {
      console.error("Error during login:", error);
      res.status(500).json({ success: false, error: "Failed to authenticate user" });
    }
  });

  // ============================================================================
  // API Routes (Using Google Apps Script Web App as the database interface)
  // ============================================================================
  
  // 1. Fetch User from Google Sheets via Apps Script (Fallback to Mock if not configured)
  app.get("/api/users/:email", async (req, res) => {
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

      const data = await response.json();
      // If Apps Script returns an error inside JSON, treat as error
      if (data.error || !data.success || !data.user) {
         return res.json({ success: false, error: data.error || "User not found" });
      }
      return res.json({ success: true, user: data.user, source: 'sheets' });

    } catch (error) {
      console.error("Error fetching users from Apps Script:", error);
      // Fallback to mock data on error
      return res.json({ success: false, error: 'Failed to connect to directory' });
    }
  });

  app.get("/api/settings/:key", async (req, res) => {
    const { key } = req.params;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    if (!scriptUrl) {
      return res.json({ success: true, key, value: key === NOTICE_BOARD_KEY ? getNoticeBoardFallback() : "", source: "mock" });
    }

    try {
      const response = await fetch(`${scriptUrl}?action=getSetting&key=${encodeURIComponent(key)}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to fetch setting");
      }
      res.json({ success: true, key, value: data.value || "", source: "sheets" });
    } catch (error: any) {
      console.error("Error fetching setting:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to fetch setting" });
    }
  });

  app.post("/api/settings", async (req, res) => {
    const { key, value } = req.body || {};
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    if (!key) {
      return res.status(400).json({ success: false, error: "Missing key" });
    }

    if (!scriptUrl) {
      return res.json({ success: true, source: "mock" });
    }

    try {
      const response = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveSetting", key, value: String(value || "") }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to save setting");
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving setting:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to save setting" });
    }
  });

  // ============================================================================
  // Admin Dashboard APIs (Form Types & Rules)
  // ============================================================================
  
  app.get("/api/form-types", async (req, res) => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.json({ formTypes: [
        { id: 'AP', name: '簽呈單 (AP)' },
        { id: 'RD', name: '請款單 (RD)' },
        { id: 'CS', name: '用印申請單 (CS)' }
      ]});
    }

    try {
      const response = await fetch(`${scriptUrl}?action=getFormTypes`);
      const data = await response.json();
      const rows = data.data || [];
      const formTypes = rows.slice(1).map((r: any) => ({ id: r[0], name: r[1] }));
      res.json({ formTypes });
    } catch (error) {
      console.error("Error fetching form types:", error);
      res.status(500).json({ error: "Failed to fetch form types" });
    }
  });

  app.post("/api/form-types", async (req, res) => {
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

  app.get("/api/form-definitions", async (req, res) => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ definitions: [] });
    try {
      const response = await fetch(`${scriptUrl}?action=getData&sheet=FormDefinitions`);
      const data = await response.json();
      const rows = data.data || [];
      const definitions = rows.slice(1).map((r: any) => ({
        formId: r[0],
        fieldsMarkdown: r[1],
        logicMarkdown: r[2],
        configJSON: r[3] ? JSON.parse(r[3]) : null
      }));
      res.json({ definitions });
    } catch (error) {
      console.error("Error fetching form definitions:", error);
      res.status(500).json({ error: "Failed to fetch form definitions" });
    }
  });

  app.post("/api/form-definitions/:formId", async (req, res) => {
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

  app.get("/api/rules/:formType", async (req, res) => {
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

  app.post("/api/rules/:formType", async (req, res) => {
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
  // 2. Submit Approval Form to Google Sheets via Apps Script
  // ============================================================================
  app.post("/api/submit-approval", async (req, res) => {
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

        const provisionalId = id || buildTicketId(formType, department);
        const needsAml = next.approver === AML_SPECIAL_ROLE ? "TRUE" : "FALSE";

        return [
          provisionalId,                     // A: 單號 (TicketID)
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
          needsAml,                          // L: 需AML查核
          JSON.stringify(formData),          // M: 完整動態資料 (FormData JSON)
          next.approver,                     // N: 目前簽核者 (CurrentApprover)
          "",                               // O: AML結果
          "",                               // P: AML備註
          "",                               // Q: 關係人交易結果
          ""                                // R: 關係人交易備註
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

      const generatedIds = Array.isArray(result.generatedIds) && result.generatedIds.length === tickets.length
        ? result.generatedIds
        : rows.map((row: any[]) => row[0]);
      res.json({ success: true, generatedIds });
    } catch (error: any) {
      console.error("Error submitting to Apps Script:", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  // 3. Fetch Pending Tickets for an Approver
  app.get("/api/tickets/pending/:email", async (req, res) => {
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

      // 2. 取得所有單據
      const ticketsRes = await fetch(`${scriptUrl}?action=getData&sheet=Tickets`);
      const ticketsData = await ticketsRes.json();
      const ticketsRows = ticketsData.data || [];

      // 3. 過濾單據：狀態為 Pending，且 CurrentApprover 是我的信箱，或是我的角色
      const pendingTickets = ticketsRows.slice(1).filter((row: any) => {
        const tStatus = row[6];
        const tApprover = row[13]; // N欄: CurrentApprover
        
        if (tStatus !== 'Pending') return false;
        
        const isMyTurn = (tApprover?.toLowerCase() === email) || myRoles.includes(tApprover);
        return isMyTurn;
      }).map((row: any) => ({
        id: row[0],
        createdAt: row[1],
        applicantEmail: row[2],
        applicantName: row[3],
        dept: row[4],
        formType: row[5],
        status: row[6],
        stage: row[7],
        subject: row[9],
        amount: row[10],
        currentApprover: row[13],
        complianceRequired: row[11] === 'TRUE' || isAmlCheckStage(ticketsRows, row[5], Number(row[7])),
        compliance: {
          aml_result: row[14] || '',
          aml_comment: row[15] || '',
          rp_result: row[16] || '',
          rp_comment: row[17] || ''
        }
      }));

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
  app.post("/api/tickets/:ticketId/action", async (req, res) => {
    const { ticketId } = req.params;
    const { action, approverEmail, comment, compliance } = req.body as { action: 'approve' | 'reject'; approverEmail: string; comment?: string; compliance?: CompliancePayload };
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
      const currentApprover = String(ticketRow[13] || '');
      const allRules = rulesData.data || [];
      const allUsers = usersData.data || [];
      const requiresCompliance = currentApprover === AML_SPECIAL_ROLE || isAmlCheckStage(allRules, formType, currentStage);

      if (action === 'approve' && requiresCompliance) {
        if (!compliance?.aml_result || !compliance?.rp_result) {
          return res.status(400).json({ error: 'AML 與關係人交易審查結果為必填。' });
        }
        if (blocksApprovalByCompliance(compliance)) {
          return res.status(400).json({ error: '此單據未通過 AML 或關係人交易審查，只能進行駁回操作。' });
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
          compliance: requiresCompliance ? {
            aml_result: compliance?.aml_result || '',
            aml_comment: compliance?.aml_comment || '',
            rp_result: compliance?.rp_result || '',
            rp_comment: compliance?.rp_comment || ''
          } : null
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

  // 5. Fetch My Own Submitted Tickets
  app.get("/api/tickets/my/:email", async (req, res) => {
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
  app.get("/api/tickets/:ticketId/logs", async (req, res) => {
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
