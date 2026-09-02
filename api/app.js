import express from "express";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { GoogleGenAI, Type } from "@google/genai";
dotenv.config({ path: ".env.local" });
dotenv.config();
const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (false) {
    throw new Error("JWT_SECRET is required in production");
  }
  return "fallback-secret-key";
};
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    if (err?.message === "JWT_SECRET is required in production") {
      return res.status(500).json({ error: "Server configuration error" });
    }
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};
const parseJsonCell = (value) => {
  if (!value) return {};
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return {};
  }
};
const extractDeptCode = (department = "") => {
  const match = String(department).trim().match(/^[A-Za-z0-9]+/);
  return (match?.[0] || "XX").toUpperCase();
};
const postToAppsScript = async (scriptUrl, payload) => {
  const response = await fetch(scriptUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
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
  { id: "AP", name: "\u7C3D\u5448\u55AE (AP)" },
  { id: "RD", name: "\u8ACB\u6B3E\u55AE (RD)" },
  { id: "CS", name: "\u7528\u5370\u7533\u8ACB\u55AE (CS)" }
];
const meetingRoomHeaders = ["RoomID", "RoomName", "Location", "Capacity", "IsActive", "SortOrder", "OpenTime", "CloseTime", "CreatedAt"];
const meetingBookingHeaders = ["BookingID", "RoomID", "RoomName", "BookerEmail", "BookerName", "Department", "Date", "StartTime", "EndTime", "Purpose", "Status", "CreatedAt", "UpdatedAt", "CancelledAt", "CancelledBy", "ReminderSentAt"];
const isAdminUser = (user) => user?.roles?.includes("ROLE:ADMIN");
const canAccessBackoffice = (user) => {
  const roles = user?.roles || [];
  return roles.some((role) => [
    "ROLE:ADMIN",
    "ROLE:ADMIN_HEAD",
    "ROLE:ADMIN_DIRECTOR",
    "ROLE:FINANCE",
    "ROLE:RISK",
    "ROLE:DEPT_HEAD",
    "ROLE:GM"
  ].includes(role));
};
const isSameUserOrAdmin = (requestedEmail, user) => isAdminUser(user) || String(user?.email || "").toLowerCase() === String(requestedEmail || "").toLowerCase();
const allowedGeneratedFieldTypes = /* @__PURE__ */ new Set(["text", "number", "date", "select", "textarea"]);
const allowedGeneratedApproverTypes = /* @__PURE__ */ new Set(["MANAGER", "ROLE", "SPECIAL:AML_CHECK", "DEPT"]);
const normalizeGeneratedFormId = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
const normalizeGeneratedApproverType = (value) => {
  const normalized = String(value || "ROLE").trim().toUpperCase();
  if (normalized === "HIERARCHY") return "MANAGER";
  return allowedGeneratedApproverTypes.has(normalized) ? normalized : "ROLE";
};
const normalizeGeneratedFields = (fields = []) => {
  return fields.map((field) => {
    const id = String(field?.id || "").trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
    const type = allowedGeneratedFieldTypes.has(String(field?.type || "text")) ? String(field.type) : "text";
    const normalized = {
      id,
      label: String(field?.label || id).trim(),
      type,
      required: field?.required !== false
    };
    if (type === "select") {
      normalized.options = Array.isArray(field?.options) ? field.options.map((option) => String(option).trim()).filter(Boolean) : [];
      if (!normalized.options.length) normalized.options = ["\u662F", "\u5426"];
    }
    return normalized;
  }).filter((field) => field.id && field.label);
};
const normalizeGeneratedRules = (rules = []) => {
  return rules.map((rule, index) => ({
    id: String(rule?.id || `rule-${Date.now()}-${index}`),
    stage: Number(rule?.stage || index + 1),
    conditionField: String(rule?.conditionField || "ALWAYS"),
    conditionOp: String(rule?.conditionOp || "=="),
    conditionVal: String(rule?.conditionVal || "TRUE"),
    approverType: normalizeGeneratedApproverType(rule?.approverType),
    approverValue: String(rule?.approverValue || "ROLE:ADMIN")
  }));
};
const rowToObject = (headers, row) => headers.reduce((record, header, index) => {
  record[header] = row[index] ?? "";
  return record;
}, {});
const normalizeDateCell = (value) => {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
};
const normalizeTimeCell = (value) => {
  if (!value) return "";
  const text = String(value);
  if (/^\d{2}:\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
};
const parseActiveFlag = (value) => {
  const normalized = String(value ?? "").trim().toUpperCase();
  return !["FALSE", "0", "NO", "N", "\u505C\u7528", "\u5426"].includes(normalized);
};
const mapMeetingRoom = (row) => {
  const item = rowToObject(meetingRoomHeaders, row);
  return {
    id: item.RoomID,
    name: item.RoomName,
    location: item.Location,
    capacity: item.Capacity,
    isActive: parseActiveFlag(item.IsActive),
    sortOrder: Number(item.SortOrder || 0),
    openTime: normalizeTimeCell(item.OpenTime) || "09:00",
    closeTime: normalizeTimeCell(item.CloseTime) || "18:00",
    createdAt: item.CreatedAt
  };
};
const mapMeetingBooking = (row) => {
  const item = rowToObject(meetingBookingHeaders, row);
  return {
    id: item.BookingID,
    roomId: item.RoomID,
    roomName: item.RoomName,
    bookerEmail: item.BookerEmail,
    bookerName: item.BookerName,
    department: item.Department,
    date: normalizeDateCell(item.Date),
    startTime: normalizeTimeCell(item.StartTime),
    endTime: normalizeTimeCell(item.EndTime),
    purpose: item.Purpose,
    status: item.Status || "Booked",
    createdAt: item.CreatedAt,
    updatedAt: item.UpdatedAt,
    cancelledAt: item.CancelledAt,
    cancelledBy: item.CancelledBy,
    reminderSentAt: item.ReminderSentAt
  };
};
async function createApp() {
  const app = express();
  app.use(express.json());
  app.post("/api/auth/login", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    const lowerEmail = email.toLowerCase();
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    let userInfo;
    if (scriptUrl) {
      try {
        const response = await fetch(`${scriptUrl}?action=getUser&email=${encodeURIComponent(lowerEmail)}`);
        if (!response.ok) {
          return res.status(503).json({ error: "Directory service unavailable" });
        }
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error("Parse error on login response", text);
          return res.status(500).json({ error: "Database response error" });
        }
        if (data.success && data.user) {
          userInfo = data.user;
        } else {
          return res.status(401).json({ error: data.error || "User not found in directory" });
        }
      } catch (err) {
        console.error("Login Error fetching user:", err);
        return res.status(503).json({ error: "Directory service unavailable" });
      }
    } else {
      const mockDbUsers = {
        "test@company.com": { name: "\u9673\u5C0F\u660E (Ming Chen)", dept: "MK (\u884C\u92B7\u4F01\u5283\u90E8)", manager: "boss@company.com", roles: "ROLE:EMPLOYEE" },
        "boss@company.com": { name: "\u674E\u5927\u65B9 (David Lee)", dept: "GM (\u7E3D\u7D93\u7406\u5BA4)", manager: "", roles: "ROLE:EMPLOYEE,ROLE:DEPT_HEAD,ROLE:GM" },
        "admin@company.com": { name: "\u738B\u7DAD\u904B (Admin)", dept: "IT (\u8CC7\u8A0A\u8655)", manager: "", roles: "ROLE:ADMIN" }
      };
      if (mockDbUsers[lowerEmail]) userInfo = mockDbUsers[lowerEmail];
      else return res.status(401).json({ error: "User not found (Mock)" });
    }
    const payload = {
      email: lowerEmail,
      name: userInfo.name,
      dept: userInfo.dept,
      manager: userInfo.manager,
      roles: (userInfo.roles || "").split(",").map((r) => r.trim()).filter(Boolean)
    };
    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
    res.json({ success: true, token, user: payload });
  });
  app.get("/api/users/:email", authMiddleware, async (req, res) => {
    const email = req.params.email.toLowerCase();
    if (!isSameUserOrAdmin(email, req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const mockDbUsers = {
      "test@company.com": { name: "\u9673\u5C0F\u660E (Ming Chen)", dept: "MK (\u884C\u92B7\u4F01\u5283\u90E8)" },
      "boss@company.com": { name: "\u674E\u5927\u65B9 (David Lee)", dept: "GM (\u7E3D\u7D93\u7406\u5BA4)" },
      "admin@company.com": { name: "\u738B\u7DAD\u904B (Admin)", dept: "IT (\u8CC7\u8A0A\u8655)" }
    };
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      console.warn("GOOGLE_APPS_SCRIPT_URL is not set. Using mock user data.");
      if (mockDbUsers[email]) {
        return res.json({ success: true, user: { ...mockDbUsers[email], manager: "", roles: "" }, source: "mock" });
      }
      return res.status(404).json({ success: false, error: "User not found (Mock)" });
    }
    try {
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
        return res.json({ success: false, error: "Apps Script \u6B0A\u9650\u932F\u8AA4\uFF1A\u8ACB\u78BA\u8A8D Google Apps Script \u7684\u5B58\u53D6\u6B0A\u9650\u662F\u5426\u8A2D\u70BA\u300C\u6240\u6709\u4EBA (Anyone)\u300D\u3002" });
      }
      if (data.error || !data.success || !data.user) {
        return res.json({ success: false, error: data.error || "User not found in spreadsheet" });
      }
      return res.json({ success: true, user: data.user, source: "sheets" });
    } catch (error) {
      console.error("Error fetching users from Apps Script:", error);
      return res.json({ success: false, error: error.message || "Failed to connect to directory" });
    }
  });
  app.get("/api/company/:taxId", authMiddleware, async (req, res) => {
    const taxId = req.params.taxId.trim();
    if (!/^\d{8}$/.test(taxId)) {
      return res.status(400).json({ error: "\u7D71\u4E00\u7DE8\u865F\u683C\u5F0F\u932F\u8AA4\uFF0C\u5FC5\u9808\u70BA 8 \u78BC\u6578\u5B57" });
    }
    const mockCompanies = {
      "23307406": { name: "\u53F0\u7063\u7A4D\u9AD4\u96FB\u8DEF\u88FD\u9020\u80A1\u4EFD\u6709\u9650\u516C\u53F8", owner: "\u9B4F\u54F2\u5BB6" },
      "23223007": { name: "\u9D3B\u6D77\u7CBE\u5BC6\u5DE5\u696D\u80A1\u4EFD\u6709\u9650\u516C\u53F8", owner: "\u5289\u63DA\u5049" },
      "23628048": { name: "\u806F\u83EF\u96FB\u5B50\u80A1\u4EFD\u6709\u9650\u516C\u53F8", owner: "\u6D2A\u5609\u8070" },
      "24033111": { name: "\u806F\u767C\u79D1\u6280\u80A1\u4EFD\u6709\u9650\u516C\u53F8", owner: "\u8521\u529B\u884C" },
      "04170449": { name: "\u4E2D\u83EF\u96FB\u4FE1\u80A1\u4EFD\u6709\u9650\u516C\u53F8", owner: "\u90ED\u6C34\u7FA9" },
      "27233186": { name: "\u5916\u5546\u4E9E\u99AC\u905C\u7DB2\u8DEF\u670D\u52D9\u6709\u9650\u516C\u53F8\u53F0\u7063\u5206\u516C\u53F8", owner: "\u738B\u5B9A\u6137" },
      "22099131": { name: "\u7F8E\u5546\u5FAE\u8EDF\u80A1\u4EFD\u6709\u9650\u516C\u53F8\u53F0\u7063\u5206\u516C\u53F8", owner: "\u535E\u5FD7\u7965" },
      "84149961": { name: "\u7F8E\u5546 Google \u53F0\u7063\u5206\u516C\u53F8", owner: "\u7C21\u7ACB\u5CF0" }
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
                owner: record.Responsible_Name || "",
                source: "gcis_api"
              });
            }
          }
        }
      }
      console.warn(`[GCIS API] Returned status ${apiResponse.status} or empty content. Falling back to local dictionary/generator.`);
    } catch (err) {
      console.error("[GCIS API] Error during request:", err.message);
    }
    if (mockCompanies[taxId]) {
      console.log(`[Local Mock] Match found for ${taxId}: ${mockCompanies[taxId].name}`);
      return res.json({
        success: true,
        name: mockCompanies[taxId].name,
        owner: mockCompanies[taxId].owner,
        source: "local_dictionary"
      });
    }
    if (false) {
      return res.status(404).json({
        success: false,
        error: "\u67E5\u7121\u53EF\u9A57\u8B49\u516C\u53F8\u8CC7\u6599\uFF0C\u8ACB\u624B\u52D5\u78BA\u8A8D\u7D71\u4E00\u7DE8\u865F\u8207\u516C\u53F8\u8CC7\u8A0A\u3002"
      });
    }
    const lastNamePool = ["\u9673", "\u6797", "\u9EC3", "\u5F35", "\u674E", "\u738B", "\u5433", "\u5289", "\u8521", "\u694A"];
    const middleNamePool = ["\u5EFA", "\u4FE1", "\u51A0", "\u5FD7", "\u5BB6", "\u4FCA", "\u96C5", "\u5A77", "\u4F73", "\u6B23"];
    const firstNamePool = ["\u5B8F", "\u5EF7", "\u5B87", "\u8C6A", "\u5091", "\u9298", "\u6DB5", "\u8431", "\u8339", "\u541B"];
    const ubnSum = taxId.split("").reduce((sum, char) => sum + parseInt(char, 10), 0);
    const lastName = lastNamePool[ubnSum % lastNamePool.length];
    const middleName = middleNamePool[ubnSum * 3 % middleNamePool.length];
    const firstName = firstNamePool[ubnSum * 7 % firstNamePool.length];
    const mockOwnerName = `${lastName}${middleName}${firstName}`;
    const mockCompanyName = `\u6A21\u64EC\u5916\u90E8\u5408\u4F5C\u5546\u80A1\u4EFD\u6709\u9650\u516C\u53F8 (\u7D71\u7DE8: ${taxId})`;
    console.log(`[Mock Generator] Generated vendor for ${taxId}: ${mockCompanyName}`);
    return res.json({
      success: true,
      name: mockCompanyName,
      owner: mockOwnerName,
      source: "local_generator"
    });
  });
  app.get("/api/settings/:key", authMiddleware, async (req, res) => {
    const { key } = req.params;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.json({ value: "\u6B61\u8FCE\u4F7F\u7528\u4F01\u696D\u5167\u90E8\u7C3D\u6838\u7CFB\u7D71\uFF01\n\n- \u82E5\u6709\u4EFB\u4F55\u7CFB\u7D71\u64CD\u4F5C\u554F\u984C\uFF0C\u8ACB\u806F\u7E6B [IT \u8CC7\u8A0A\u8655](#)\u3002\n- [\u9EDE\u64CA\u6B64\u8655\u67E5\u770B\u7C3D\u6838\u6D41\u7A0B\u898F\u7BC4\u6587\u4EF6](#)" });
    }
    try {
      const response = await fetch(`${scriptUrl}?action=getData&sheet=SystemSettings`);
      const data = await response.json();
      const rows = data.data || [];
      const settingRow = rows.find((r) => r[0] === key);
      res.json({ value: settingRow ? settingRow[1] : "" });
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });
  app.post("/api/settings", authMiddleware, async (req, res) => {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const { key, value } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true });
    try {
      const payload = {
        action: "saveData",
        sheet: "SystemSettings",
        matchColumn: 1,
        // Key
        matchValue: key,
        row: [key, value]
      };
      const response = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving setting:", error);
      res.status(500).json({ error: error.message });
    }
  });
  app.post("/api/ai-form-model", authMiddleware, async (req, res) => {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const formName = String(req.body.formName || "").trim();
    const formId = normalizeGeneratedFormId(req.body.formId || "");
    const requirement = String(req.body.requirement || "").trim();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!formName || !formId || !requirement) {
      return res.status(400).json({ error: "\u8ACB\u586B\u5BEB\u5B8C\u6574\u8868\u55AE\u540D\u7A31\u3001\u7E2E\u5BEB\u4EE3\u865F\u8207\u9700\u6C42\u5167\u5BB9" });
    }
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      return res.status(500).json({ error: "\u5C1A\u672A\u8A2D\u5B9A GEMINI_API_KEY\uFF0C\u8ACB\u5148\u5230 Vercel Environment Variables \u8A2D\u5B9A\u3002" });
    }
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `\u4F60\u662F\u4E00\u500B\u4F01\u696D\u5167\u90E8\u7533\u8ACB\u7CFB\u7D71\u7684\u8868\u55AE\u898F\u683C\u9867\u554F\u3002

\u5E73\u53F0\u80CC\u666F\uFF1A
- \u9019\u662F 21CD \u5167\u90E8\u7533\u8ACB\u7CFB\u7D71\uFF0C\u76EE\u524D\u6D41\u7A0B\u662F\u7533\u8ACB\u4EBA\u586B\u55AE\u3001\u7522\u751F\u55AE\u865F\u3001\u5BC4\u4FE1\u3001\u5217\u5370\u7533\u8ACB\u55AE\u3001\u5F8C\u53F0\u4EBA\u54E1\u5B8C\u6210\u7D50\u6848\u3002
- \u4E0D\u662F\u7DDA\u4E0A\u4E3B\u7BA1\u7C3D\u6838\u7CFB\u7D71\uFF0C\u6240\u4EE5\u8ACB\u4E0D\u8981\u8A2D\u8A08\u4E3B\u7BA1\u9010\u95DC\u6838\u51C6\u8A9E\u53E5\u3002
- \u6240\u6709\u8868\u55AE\u90FD\u6703\u7531\u7CFB\u7D71\u984D\u5916\u652F\u63F4\u300C\u662F\u5426\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546\u300D\u53CA\u7D71\u7DE8/AML \u8CC7\u6599\u6B04\u4F4D\uFF0C\u9664\u975E\u4F7F\u7528\u8005\u660E\u78BA\u8981\u6C42\uFF0C\u8ACB\u907F\u514D\u91CD\u8907\u7522\u751F ext_tax_id\u3001ext_company_name\u3001ext_company_owner\u3002
- \u6B04\u4F4D id \u8ACB\u4F7F\u7528\u82F1\u6587\u5C0F\u5BEB\u8207\u5E95\u7DDA\uFF0C\u6B04\u4F4D\u578B\u614B\u53EA\u80FD\u4F7F\u7528 text\u3001number\u3001date\u3001select\u3001textarea\u3002

\u8868\u55AE\u540D\u7A31\uFF1A${formName}
\u8868\u55AE\u4EE3\u865F\uFF1A${formId}
\u9700\u6C42\u63CF\u8FF0\uFF1A${requirement}

\u8ACB\u56B4\u683C\u56DE\u50B3 JSON\uFF0C\u5167\u5BB9\u5FC5\u9808\u5305\u542B\uFF1A
1. fields: \u6B04\u4F4D\u9663\u5217\uFF0C\u6BCF\u500B\u6B04\u4F4D\u5305\u542B id\u3001label\u3001type\u3001options\u3001required\u3002
2. rules: \u5F8C\u53F0\u8655\u7406\u63D0\u793A\u898F\u5247\u9663\u5217\uFF0C\u6BCF\u7B46\u5305\u542B stage\u3001conditionField\u3001conditionOp\u3001conditionVal\u3001approverType\u3001approverValue\u3002\u82E5\u6C92\u6709\u7279\u6B8A\u5F8C\u53F0\u89D2\u8272\uFF0C\u8ACB\u7D66\u4E00\u7B46 ROLE:ADMIN\u3002
3. fieldsMarkdown: \u7D66\u7BA1\u7406\u54E1\u770B\u7684 Markdown \u6B04\u4F4D\u6E05\u55AE\u8AAA\u660E\u3002
4. logicMarkdown: \u7D66\u7BA1\u7406\u54E1\u770B\u7684 Markdown \u5F8C\u53F0\u8655\u7406\u6D41\u7A0B\u8AAA\u660E\u3002`;
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              fields: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    label: { type: Type.STRING },
                    type: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    required: { type: Type.BOOLEAN }
                  }
                }
              },
              rules: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    stage: { type: Type.NUMBER },
                    conditionField: { type: Type.STRING },
                    conditionOp: { type: Type.STRING },
                    conditionVal: { type: Type.STRING },
                    approverType: { type: Type.STRING },
                    approverValue: { type: Type.STRING }
                  }
                }
              },
              fieldsMarkdown: { type: Type.STRING },
              logicMarkdown: { type: Type.STRING }
            }
          }
        }
      });
      const raw = JSON.parse(response.text || "{}");
      const fields = normalizeGeneratedFields(raw.fields);
      if (!fields.length) throw new Error("AI \u672A\u7522\u751F\u53EF\u7528\u6B04\u4F4D\uFF0C\u8ACB\u88DC\u5145\u9700\u6C42\u5F8C\u518D\u8A66\u4E00\u6B21\u3002");
      res.json({
        formId,
        fieldsMarkdown: String(raw.fieldsMarkdown || ""),
        logicMarkdown: String(raw.logicMarkdown || ""),
        fields,
        rules: normalizeGeneratedRules(raw.rules)
      });
    } catch (error) {
      console.error("Error generating AI form model:", error);
      res.status(500).json({ error: error.message || "AI \u7522\u751F\u8868\u55AE\u898F\u683C\u5931\u6557" });
    }
  });
  app.get("/api/form-types", authMiddleware, async (req, res) => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.json({ formTypes: defaultFormTypes });
    }
    try {
      const response = await fetch(`${scriptUrl}?action=getFormTypes`);
      const data = await response.json();
      const rows = data.data || [];
      const formTypes = rows.slice(1).map((r) => ({ id: r[0], name: r[1] })).filter((form) => form.id && form.name);
      res.json({ formTypes: formTypes.length ? formTypes : defaultFormTypes });
    } catch (error) {
      console.error("Error fetching form types:", error);
      res.status(500).json({ error: "Failed to fetch form types" });
    }
  });
  app.post("/api/form-types", authMiddleware, async (req, res) => {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const { id, name } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true });
    try {
      const response = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "addFormType", formId: id, formName: name })
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      res.json({ success: true });
    } catch (error) {
      console.error("Error adding form type:", error);
      res.status(500).json({ error: error.message });
    }
  });
  app.get("/api/form-definitions", authMiddleware, async (req, res) => {
    const localDefinitions = [
      {
        formId: "AP",
        fieldsMarkdown: `# \u7C3D\u5448\u55AE (AP) \u6B04\u4F4D\u8A2D\u8A08

\u672C\u8868\u55AE\u7528\u65BC\u4E00\u822C\u4E8B\u52D9\u4E4B\u7C3D\u6838\u8207\u6838\u5B9A\uFF0C\u652F\u63F4\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546\u6642\u4E4B\u52D5\u614B\u6B04\u4F4D\u64F4\u5145\u8207 AML/\u516C\u53F8\u8CC7\u8A0A\u81EA\u52D5\u5E36\u5165\u3002

| \u6B04\u4F4D ID | \u6B04\u4F4D\u540D\u7A31 | \u6B04\u4F4D\u578B\u614B | \u5FC5\u586B | \u8AAA\u660E/\u52D5\u614B\u986F\u793A\u689D\u4EF6 |
| :--- | :--- | :--- | :--- | :--- |
| **subject** | \u4E3B\u65E8 | \u55AE\u884C\u6587\u5B57 | \u662F | \u8ACB\u7C21\u8FF0\u7C3D\u5448\u4E4B\u4E3B\u65E8\u8207\u4E3B\u8981\u76EE\u7684 |
| **description** | \u5167\u5BB9\u8AAA\u660E | \u591A\u884C\u6587\u5B57 | \u662F | \u8A73\u7D30\u8AAA\u660E\u672C\u7C3D\u5448\u4E4B\u539F\u56E0\u3001\u5167\u5BB9\u8207\u80CC\u666F |
| **attachment** | \u9644\u4EF6\u4E0A\u50B3 | \u55AE\u884C\u6587\u5B57 | \u5426 | \u8ACB\u8CBC\u4E0A\u76F8\u95DC\u96F2\u7AEF\u9023\u7D50\u6216\u8CC7\u6599\u593E\u8DEF\u5F91 |
| **external_collab** | \u662F\u5426\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546 | \u4E0B\u62C9\u9078\u55AE | \u662F | \u53EF\u9078\u64C7\u300C\u662F\u300D\u6216\u300C\u5426\u300D |
| **ext_tax_id** | \u7D71\u4E00\u7DE8\u865F/\u8B58\u5225\u78BC | \u55AE\u884C\u6587\u5B57 | \u662F | \u7576\u300C\u662F\u5426\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546\u300D\u9078\u64C7\u300C\u662F\u300D\u6642\u986F\u793A\uFF0C\u8F38\u5165\u5F8C\u81EA\u52D5\u5E36\u5165\u5EE0\u5546\u8207\u8CA0\u8CAC\u4EBA\u8CC7\u6599 |
| **ext_company_name** | \u5EE0\u5546\u540D\u7A31/\u516C\u53F8\u540D\u7A31 | \u55AE\u884C\u6587\u5B57 | \u662F | \u7576\u300C\u662F\u5426\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546\u300D\u9078\u64C7\u300C\u662F\u300D\u6642\u986F\u793A\uFF0C\u81EA\u52D5\u7531 API \u5E36\u5165\uFF0C\u53EF\u624B\u52D5\u4FEE\u6539 |
| **ext_company_owner** | \u8CA0\u8CAC\u4EBA\u59D3\u540D | \u55AE\u884C\u6587\u5B57 | \u662F | \u7576\u300C\u662F\u5426\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546\u300D\u9078\u64C7\u300C\u662F\u300D\u6642\u986F\u793A\uFF0C\u81EA\u52D5\u7531 API \u5E36\u5165\uFF0C\u53EF\u624B\u52D5\u4FEE\u6539 |`,
        logicMarkdown: `# \u7C3D\u5448\u55AE (AP) \u7C3D\u6838\u908F\u8F2F\u77E9\u9663

\u6839\u64DA\u7C3D\u4EF6\u5C6C\u6027\uFF0C\u7CFB\u7D71\u5C07\u81EA\u52D5\u5206\u6D3E\u81F3\u5C0D\u61C9\u7684\u7C3D\u6838\u5C64\u7D1A\u3002\u672C\u8868\u55AE\u652F\u63F4\u52D5\u614B AML \u8ABF\u67E5\u95DC\u5361\u3002

\`\`\`mermaid
graph TD
    Start([1. \u7533\u8ACB\u4EBA\u9001\u51FA]) --> Stage1[2. \u76F4\u5C6C\u4E3B\u7BA1\u7C3D\u6838]
    Stage1 --> Stage2[3. \u672C\u90E8\u90E8\u9577\u7C3D\u6838]
    Stage2 --> Cond{\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546?}
    Cond -- \u662F (\u4E14\u9700\u9032\u884C AML \u8ABF\u67E5) --> Stage3[4. AML\u8ABF\u67E5\u8207\u6CD5\u9075\u5BE9\u67E5]
    Cond -- \u5426 --> Stage4[5. \u884C\u653F\u526F\u7E3D\u6838\u6C7A]
    Stage3 --> Stage4
    Stage4 --> Stage5[6. \u7E3D\u7D93\u7406\u7D42\u5BE9]
    Stage5 --> End([\u7C3D\u6838\u5B8C\u6210\u4E26\u6B78\u6A94])
\`\`\`

### \u7C3D\u6838\u95DC\u5361\u660E\u7D30

| \u95DC\u5361 | \u7C3D\u6838\u89D2\u8272 | \u89F8\u767C\u689D\u4EF6 | \u8AAA\u660E |
| :--- | :--- | :--- | :--- |
| **\u7B2C 1 \u95DC** | \u76F4\u5C6C\u4E3B\u7BA1 (MANAGER) | \u7121\u689D\u4EF6 | \u7533\u8ACB\u4EBA\u4E4B\u76F4\u63A5\u532F\u5831\u4E3B\u7BA1\u7B2C\u4E00\u968E\u6BB5\u5BE9\u67E5 |
| **\u7B2C 2 \u95DC** | \u90E8\u9580\u7D93\u7406/\u90E8\u9577 (DEPT_HEAD) | \u7121\u689D\u4EF6 | \u90E8\u9580\u4E00\u7D1A\u4E3B\u7BA1\u4E4B\u8907\u5BE9\u8207\u6838\u53EF |
| **\u7B2C 3 \u95DC** | AML \u8ABF\u67E5\u8207\u6CD5\u9075\u5BE9\u67E5 (SPECIAL:AML_CHECK / ADMIN_DIRECTOR) | **external_collab == '\u662F'** | \u5916\u90E8\u5EE0\u5546\u7D71\u4E00\u7DE8\u865F\u81EA\u52D5\u89F8\u767C AML/\u9ED1\u540D\u55AE\u6BD4\u5C0D\u8207\u6CD5\u9075\u4E3B\u7BA1\u7C3D\u6838 |
| **\u7B2C 4 \u95DC** | \u884C\u653F\u526F\u7E3D (ADMIN_VP) | \u7121\u689D\u4EF6 | \u7BA1\u7406\u672C\u90E8\u6700\u9AD8\u4E3B\u7BA1\u5BE9\u67E5 |
| **\u7B2C 5 \u95DC** | \u7E3D\u7D93\u7406 (GM) | \u7121\u689D\u4EF6 | \u7D42\u5BE9\u8207\u6700\u9AD8\u6838\u6C7A |`,
        configJSON: {
          fields: [
            { id: "subject", label: "\u4E3B\u65E8", type: "text", required: true },
            { id: "description", label: "\u5167\u5BB9\u8AAA\u660E", type: "textarea", required: true },
            { id: "attachment", label: "\u9644\u4EF6\u4E0A\u50B3 (\u8ACB\u8CBC\u4E0A\u96F2\u7AEF\u9023\u7D50)", type: "text", required: false },
            { id: "external_collab", label: "\u662F\u5426\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546", type: "select", options: ["\u5426", "\u662F"], required: true },
            { id: "ext_tax_id", label: "\u7D71\u4E00\u7DE8\u865F/\u8B58\u5225\u78BC", type: "text", required: true, showIf: { field: "external_collab", value: "\u662F" } },
            { id: "ext_company_name", label: "\u5EE0\u5546\u540D\u7A31/\u516C\u53F8\u540D\u7A31", type: "text", required: true, showIf: { field: "external_collab", value: "\u662F" } },
            { id: "ext_company_owner", label: "\u8CA0\u8CAC\u4EBA\u59D3\u540D", type: "text", required: true, showIf: { field: "external_collab", value: "\u662F" } }
          ]
        }
      },
      {
        formId: "RD",
        fieldsMarkdown: `# \u8ACB\u6B3E\u55AE (RD) \u6B04\u4F4D\u8A2D\u8A08

\u672C\u8868\u55AE\u4F9B\u5404\u90E8\u9580\u9032\u884C\u8ACB\u6B3E\u8207\u6838\u92B7\u4F5C\u696D\uFF0C\u6574\u5408\u5916\u90E8\u5408\u4F5C\u5EE0\u5546\u4E4B AML \u8ABF\u67E5\u8207\u7D71\u4E00\u7DE8\u865F\u5FEB\u901F\u5E36\u5165\u3002

| \u6B04\u4F4D ID | \u6B04\u4F4D\u540D\u7A31 | \u6B04\u4F4D\u578B\u614B | \u5FC5\u586B | \u8AAA\u660E/\u52D5\u614B\u986F\u793A\u689D\u4EF6 |
| :--- | :--- | :--- | :--- | :--- |
| **related_ticket** | \u76F8\u95DC\u55AE\u865F | \u55AE\u884C\u6587\u5B57 | \u5426 | \u642D\u914D\u8ACB/\u63A1\u8CFC\u55AE\u865F\u4F7F\u7528\uFF0C\u4FBF\u65BC\u52FE\u7A3D |
| **amount** | \u8ACB\u6B3E\u91D1\u984D | \u6578\u503C | \u662F | \u672C\u6B21\u8ACB\u6B3E\u4E4B\u5BE6\u969B\u65B0\u53F0\u5E63\u91D1\u984D |
| **external_collab** | \u662F\u5426\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546 | \u4E0B\u62C9\u9078\u55AE | \u662F | \u53EF\u9078\u64C7\u300C\u662F\u300D\u6216\u300C\u5426\u300D |
| **vendor_name** | \u5EE0\u5546\u540D\u7A31 | \u55AE\u884C\u6587\u5B57 | \u662F | \u7576\u300C\u662F\u5426\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546\u300D\u70BA\u300C\u5426\u300D\u6642\u986F\u793A |
| **ext_tax_id** | \u7D71\u4E00\u7DE8\u865F/\u8B58\u5225\u78BC | \u55AE\u884C\u6587\u5B57 | \u662F | \u7576\u300C\u662F\u5426\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546\u300D\u70BA\u300C\u662F\u300D\u6642\u986F\u793A\uFF0C\u8F38\u5165\u5F8C\u81EA\u52D5\u5E36\u5165\u5EE0\u5546\u8207\u8CA0\u8CAC\u4EBA\u8CC7\u6599 |
| **ext_company_name** | \u5EE0\u5546\u540D\u7A31/\u516C\u53F8\u540D\u7A31 | \u55AE\u884C\u6587\u5B57 | \u662F | \u7576\u300C\u662F\u5426\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546\u300D\u70BA\u300C\u662F\u300D\u6642\u986F\u793A\uFF0C\u81EA\u52D5\u7531 API \u5E36\u5165\uFF0C\u53EF\u624B\u52D5\u4FEE\u6539 |
| **ext_company_owner** | \u8CA0\u8CAC\u4EBA\u59D3\u540D | \u55AE\u884C\u6587\u5B57 | \u662F | \u7576\u300C\u662F\u5426\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546\u300D\u70BA\u300C\u662F\u300D\u6642\u986F\u793A\uFF0C\u81EA\u52D5\u7531 API \u5E36\u5165\uFF0C\u53EF\u624B\u52D5\u4FEE\u6539 |
| **payment_date** | \u4ED8\u6B3E\u671F\u9650 | \u65E5\u671F | \u662F | \u9810\u8A08\u4ED8\u6B3E\u4E4B\u65E5\u671F |
| **payment_method** | \u4ED8\u6B3E\u65B9\u5F0F | \u4E0B\u62C9\u9078\u55AE | \u662F | \u53EF\u9078\u64C7\u300C\u532F\u6B3E\u300D\u3001\u300C\u73FE\u91D1\u300D\u6216\u300C\u5DF2\u7531\u7533\u8ACB\u4EBA\u4EE3\u588A\u300D |
| **description** | \u8ACB\u6B3E\u7528\u9014\u8AAA\u660E | \u591A\u884C\u6587\u5B57 | \u662F | \u8A73\u7D30\u8AAA\u660E\u672C\u6B21\u8ACB\u6B3E\u4E4B\u7528\u9014\u8207\u660E\u7D30 |
| **attachment** | \u6AA2\u9644\u55AE\u64DA | \u55AE\u884C\u6587\u5B57 | \u662F | \u8ACB\u8CBC\u4E0A\u767C\u7968\u3001\u6536\u64DA\u6216\u76F8\u95DC\u6191\u8B49\u4E4B\u96F2\u7AEF/\u5171\u4EAB\u8CC7\u6599\u593E\u9023\u7D50 |`,
        logicMarkdown: `# \u8ACB\u6B3E\u55AE (RD) \u7C3D\u6838\u908F\u8F2F\u77E9\u9663

\u8ACB\u6B3E\u55AE\u7C3D\u6838\u4F9D\u64DA\u8ACB\u6B3E\u91D1\u984D\u5BE6\u65BD\u5206\u7D1A\u6388\u6B0A\u3002\u91D1\u984D\u5927\u65BC\u65B0\u53F0\u5E63 5,000 \u5143\u6642\u5C07\u81EA\u52D5\u52A0\u6703\u9AD8\u968E\u4E3B\u7BA1\u3002

\`\`\`mermaid
graph TD
    Start([1. \u7533\u8ACB\u4EBA\u9001\u51FA]) --> Stage1[2. \u76F4\u5C6C\u4E3B\u7BA1\u7C3D\u6838]
    Stage1 --> Stage2[3. \u672C\u90E8\u90E8\u9577\u7C3D\u6838]
    Stage2 --> Cond{\u8ACB\u6B3E\u91D1\u984D > 5,000 \u5143?}
    Cond -- \u662F --> Stage3[4. \u884C\u653F\u526F\u7E3D\u5BE9\u6838]
    Stage3 --> Stage4[5. \u7E3D\u7D93\u7406\u6838\u6C7A]
    Stage4 --> End([\u7C3D\u6838\u5B8C\u6210\u4E26\u64A5\u6B3E])
    Cond -- \u5426 --> End
\`\`\`

### \u7C3D\u6838\u95DC\u5361\u660E\u7D30

| \u95DC\u5361 | \u7C3D\u6838\u89D2\u8272 | \u89F8\u767C\u689D\u4EF6 | \u8AAA\u660E |
| :--- | :--- | :--- | :--- |
| **\u7B2C 1 \u95DC** | \u76F4\u5C6C\u4E3B\u7BA1 (MANAGER) | \u7121\u689D\u4EF6 | \u7533\u8ACB\u4EBA\u4E4B\u76F4\u5C6C\u4E3B\u7BA1\u9032\u884C\u521D\u6B65\u9810\u7B97\u8207\u5408\u7406\u6027\u5BE9\u67E5 |
| **\u7B2C 2 \u95DC** | \u90E8\u9580\u7D93\u7406/\u90E8\u9577 (DEPT_HEAD) | \u7121\u689D\u4EF6 | \u90E8\u9580\u4E00\u7D1A\u4E3B\u7BA1\u4E4B\u8907\u5BE9\u8207\u984D\u5EA6\u78BA\u8A8D |
| **\u7B2C 3 \u95DC** | \u884C\u653F\u526F\u7E3D (ADMIN_VP) | **amount > 5000** | \u91D1\u984D\u8D85\u904E 5,000 \u5143\u6642\u52A0\u6703\u884C\u653F\u526F\u7E3D\u9032\u884C\u516C\u53F8\u7D1A\u5BE9\u67E5 |
| **\u7B2C 4 \u95DC** | \u7E3D\u7D93\u7406 (GM) | **amount > 5000** | \u91D1\u984D\u8D85\u904E 5,000 \u5143\u6642\u9700\u7D93\u7E3D\u7D93\u7406\u6700\u7D42\u6838\u51C6 |`,
        configJSON: {
          fields: [
            { id: "related_ticket", label: "\u76F8\u95DC\u55AE\u865F (\u642D\u914D\u8ACB/\u63A1\u8CFC\u55AE\u865F)", type: "text", required: false },
            { id: "amount", label: "\u8ACB\u6B3E\u91D1\u984D", type: "number", required: true },
            { id: "external_collab", label: "\u662F\u5426\u6D89\u53CA\u5916\u90E8\u5408\u4F5C\u5EE0\u5546", type: "select", options: ["\u5426", "\u662F"], required: true },
            { id: "vendor_name", label: "\u5EE0\u5546\u540D\u7A31", type: "text", required: true, showIf: { field: "external_collab", value: "\u5426" } },
            { id: "ext_tax_id", label: "\u7D71\u4E00\u7DE8\u865F/\u8B58\u5225\u78BC", type: "text", required: true, showIf: { field: "external_collab", value: "\u662F" } },
            { id: "ext_company_name", label: "\u5EE0\u5546\u540D\u7A31/\u516C\u53F8\u540D\u7A31", type: "text", required: true, showIf: { field: "external_collab", value: "\u662F" } },
            { id: "ext_company_owner", label: "\u8CA0\u8CAC\u4EBA\u59D3\u540D", type: "text", required: true, showIf: { field: "external_collab", value: "\u662F" } },
            { id: "payment_date", label: "\u4ED8\u6B3E\u671F\u9650", type: "date", required: true },
            { id: "payment_method", label: "\u4ED8\u6B3E\u65B9\u5F0F", type: "select", options: ["\u532F\u6B3E", "\u73FE\u91D1", "\u5DF2\u7531\u7533\u8ACB\u4EBA\u4EE3\u588A"], required: true },
            { id: "description", label: "\u8ACB\u6B3E\u7528\u9014\u8AAA\u660E", type: "textarea", required: true },
            { id: "attachment", label: "\u6AA2\u9644\u55AE\u64DA (\u8ACB\u8CBC\u4E0A\u96F2\u7AEF/\u8CC7\u6599\u593E\u9023\u7D50)", type: "text", required: true }
          ]
        }
      },
      {
        formId: "CS",
        fieldsMarkdown: `# \u7528\u5370\u7533\u8ACB\u55AE (CS) \u6B04\u4F4D\u8A2D\u8A08

\u672C\u8868\u55AE\u7528\u65BC\u516C\u53F8\u5404\u985E\u5370\u4FE1\uFF08\u5982\u7D93\u6FDF\u90E8\u7AE0\u3001\u5927\u7AE0\u3001\u5C0F\u7AE0\u3001\u6CD5\u52D9\u7AE0\u3001\u767C\u7968\u7AE0\u7B49\uFF09\u4E4B\u4F7F\u7528\u7533\u8ACB\u8207\u7BA1\u5236\u767B\u8A18\u3002

| \u6B04\u4F4D ID | \u6B04\u4F4D\u540D\u7A31 | \u6B04\u4F4D\u578B\u614B | \u5FC5\u586B | \u8AAA\u660E/\u52D5\u614B\u986F\u793A\u689D\u4EF6 |
| :--- | :--- | :--- | :--- | :--- |
| **related_ticket** | \u76F8\u95DC\u55AE\u865F | \u55AE\u884C\u6587\u5B57 | \u5426 | \u642D\u914D\u8ACB/\u63A1\u8CFC\u55AE\u865F\u6216\u5408\u7D04\u55AE\u865F\uFF0C\u4FBF\u65BC\u5F8C\u7E8C\u6838\u5C0D |
| **seal_type** | \u7528\u5370\u985E\u5225 | \u4E0B\u62C9\u9078\u55AE | \u662F | \u53EF\u9078\u64C7\uFF1A\u300C\u7D93\u6FDF\u90E8\u7AE0\u300D\u3001\u300C\u9280\u884C\u7528\u7AE0\u300D\u3001\u300C\u6CD5\u52D9\u7AE0\u300D\u3001\u300C\u767C\u7968\u7AE0\u300D\u3001\u300C\u5408\u7D04\u4FBF\u7AE0\u300D |
| **description** | \u7528\u5370\u6587\u4EF6\u8AAA\u660E | \u591A\u884C\u6587\u5B57 | \u662F | \u8ACB\u8A73\u7D30\u8AAA\u660E\u672C\u6B21\u7528\u5370\u4E4B\u6587\u4EF6\u540D\u7A31\u3001\u7528\u9014\u8207\u4EFD\u6578 |
| **attachment** | \u7528\u5370\u6587\u4EF6\u8349\u7A3F | \u55AE\u884C\u6587\u5B57 | \u662F | \u8ACB\u8CBC\u4E0A\u5F85\u7528\u5370\u6587\u4EF6\u8349\u7A3F\u4E4B\u96F2\u7AEF\u9023\u7D50\u4EE5\u4F9B\u5BE9\u6838 |`,
        logicMarkdown: `# \u7528\u5370\u7533\u8ACB\u55AE (CS) \u7C3D\u6838\u908F\u8F2F\u77E9\u9663

\u7528\u5370\u7C3D\u6838\u4F9D\u64DA\u5370\u4FE1\u7A2E\u985E\u4E4B\u91CD\u8981\u6027\u9032\u884C\u5206\u7D1A\u7C3D\u6838\u3002\u91CD\u5927\u5370\u4FE1\uFF08\u975E\u767C\u7968\u7AE0\uFF09\u5747\u9700\u7D93\u9AD8\u968E\u4E3B\u7BA1\u8207\u5370\u4FE1\u7BA1\u7406\u4EBA\u6838\u653E\u3002

\`\`\`mermaid
graph TD
    Start([1. \u7533\u8ACB\u4EBA\u9001\u51FA]) --> CondLegal{\u662F\u5426\u70BA\u5408\u7D04\u4FBF\u7AE0?}
    CondLegal -- \u662F --> StageLegal[2. \u6CD5\u52D9\u5BE9\u67E5]
    CondLegal -- \u5426 --> StageManager[3. \u76F4\u5C6C\u4E3B\u7BA1\u7C3D\u6838]
    StageLegal --> StageManager
    StageManager --> StageDept[4. \u672C\u90E8\u90E8\u9577\u7C3D\u6838]
    StageDept --> CondBig{\u662F\u5426\u70BA\u767C\u7968\u7AE0?}
    CondBig -- \u5426 (\u7D93\u6FDF\u90E8\u7AE0/\u9280\u884C\u7528\u7AE0/\u6CD5\u52D9\u7AE0/\u5408\u7D04\u4FBF\u7AE0) --> StageVP[5. \u884C\u653F\u526F\u7E3D\u5BE9\u6838]
    StageVP --> StageGM[6. \u7E3D\u7D93\u7406\u6838\u6C7A]
    StageGM --> StageBig[7. \u5927\u7AE0\u7BA1\u7406\u4EBA\u84CB\u7AE0]
    StageBig --> StageSmall[8. \u5C0F\u7AE0\u7BA1\u7406\u4EBA\u84CB\u7AE0]
    StageSmall --> End([\u5B8C\u6210\u7528\u5370\u4E26\u6B78\u6A94])
    CondBig -- \u662F (\u767C\u7968\u7AE0\u7531\u90E8\u9580\u5167\u63A7\u76F4\u63A5\u63D0\u65E9\u7D50\u6848) --> End
\`\`\`

### \u7C3D\u6838\u95DC\u5361\u660E\u7D30

| \u95DC\u5361 | \u7C3D\u6838\u89D2\u8272 | \u89F8\u767C\u689D\u4EF6 | \u8AAA\u660E |
| :--- | :--- | :--- | :--- |
| **\u7B2C 1 \u95DC** | \u6CD5\u52D9\u8655 (ROLE:LEGAL) | **seal_type == '\u5408\u7D04\u4FBF\u7AE0'** | \u5408\u7D04\u985E\u6587\u4EF6\u9700\u7531\u6CD5\u52D9\u8655\u9032\u884C\u5408\u7D04\u689D\u6B3E\u8207\u5408\u898F\u6027\u9996\u7C3D\u5BE9\u67E5 |
| **\u7B2C 2 \u95DC** | \u76F4\u5C6C\u4E3B\u7BA1 (MANAGER) | \u7121\u689D\u4EF6 | \u7533\u8ACB\u4EBA\u4E4B\u76F4\u63A5\u4E3B\u7BA1\u521D\u6B65\u5BE9\u67E5\u7528\u5370\u5408\u7406\u6027 |
| **\u7B2C 3 \u95DC** | \u90E8\u9580\u7D93\u7406/\u90E8\u9577 (DEPT_HEAD) | \u7121\u689D\u4EF6 | \u90E8\u9580\u4E00\u7D1A\u4E3B\u7BA1\u8907\u5BE9 |
| **\u7B2C 4 \u95DC** | \u884C\u653F\u526F\u7E3D (ADMIN_VP) | **seal_type != '\u767C\u7968\u7AE0'** | \u91CD\u5927\u5370\u4FE1\u7528\u5370\u9700\u7D93\u7BA1\u7406\u672C\u90E8\u6700\u9AD8\u4E3B\u7BA1\u6838\u51C6 |
| **\u7B2C 5 \u95DC** | \u7E3D\u7D93\u7406 (GM) | **seal_type != '\u767C\u7968\u7AE0'** | \u91CD\u5927\u5370\u4FE1\u7528\u5370\u9700\u7D93\u7E3D\u7D93\u7406\u6700\u7D42\u6838\u51C6 |
| **\u7B2C 6 \u95DC** | \u5927\u7AE0\u7BA1\u7406\u4EBA (ROLE:BIG_SEAL_MGR) | **seal_type != '\u767C\u7968\u7AE0'** | \u5927\u7AE0\u5C08\u8CAC\u4FDD\u7BA1\u4EBA\u54E1\u57F7\u884C\u7528\u5370\u64CD\u4F5C\u8207\u767B\u8A18 |
| **\u7B2C 7 \u95DC** | \u5C0F\u7AE0\u7BA1\u7406\u4EBA (ROLE:SMALL_SEAL_MGR) | **seal_type != '\u767C\u7968\u7AE0'** | \u5C0F\u7AE0\u5C08\u8CAC\u4FDD\u7BA1\u4EBA\u54E1\u57F7\u884C\u7528\u5370\u64CD\u4F5C\u8207\u767B\u8A18 |`,
        configJSON: {
          fields: [
            { id: "related_ticket", label: "\u76F8\u95DC\u55AE\u865F (\u642D\u914D\u8ACB/\u63A1\u8CFC\u55AE\u865F)", type: "text", required: false },
            { id: "seal_type", label: "\u7528\u5370\u985E\u5225", type: "select", options: ["\u7D93\u6FDF\u90E8\u7AE0", "\u9280\u884C\u7528\u7AE0", "\u6CD5\u52D9\u7AE0", "\u767C\u7968\u7AE0", "\u5408\u7D04\u4FBF\u7AE0"], required: true },
            { id: "description", label: "\u7528\u5370\u6587\u4EF6\u8AAA\u660E", type: "textarea", required: true },
            { id: "attachment", label: "\u7528\u5370\u6587\u4EF6\u8349\u7A3F (\u8ACB\u8CBC\u4E0A\u96F2\u7AEF\u9023\u7D50)", type: "text", required: true }
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
      const fetchedDefinitions = rows.slice(1).map((r) => {
        const formId = r[0];
        const configJSON = r[3] ? JSON.parse(r[3]) : null;
        return {
          formId,
          fieldsMarkdown: r[1],
          logicMarkdown: r[2],
          configJSON
        };
      });
      const merged = fetchedDefinitions.map((def) => {
        const local = localDefinitions.find((l) => l.formId === def.formId);
        if (local) {
          const forceLocalDefinition = def.formId === "RD";
          return {
            ...def,
            fieldsMarkdown: forceLocalDefinition ? local.fieldsMarkdown : def.fieldsMarkdown && def.fieldsMarkdown.trim() ? def.fieldsMarkdown : local.fieldsMarkdown,
            logicMarkdown: forceLocalDefinition ? local.logicMarkdown : def.logicMarkdown && def.logicMarkdown.trim() ? def.logicMarkdown : local.logicMarkdown,
            configJSON: local.configJSON
          };
        }
        return def;
      });
      localDefinitions.forEach((local) => {
        if (!merged.some((m) => m.formId === local.formId)) {
          merged.push(local);
        }
      });
      res.json({ definitions: merged });
    } catch (error) {
      console.error("Error fetching form definitions:", error);
      res.json({ definitions: localDefinitions });
    }
  });
  app.post("/api/form-definitions/:formId", authMiddleware, async (req, res) => {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const { formId } = req.params;
    const { fieldsMarkdown, logicMarkdown, configJSON } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.status(500).json({ error: "GAS URL not configured" });
    try {
      const payload = {
        action: "saveData",
        sheet: "FormDefinitions",
        matchColumn: 1,
        // FormID
        matchValue: formId,
        row: [formId, fieldsMarkdown, logicMarkdown, JSON.stringify(configJSON)]
      };
      const response = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving form definition:", error);
      res.status(500).json({ error: error.message });
    }
  });
  app.get("/api/rules/:formType", authMiddleware, async (req, res) => {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const { formType } = req.params;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.json({ rules: [] });
    }
    try {
      const response = await fetch(`${scriptUrl}?action=getRules&formType=${formType}`);
      const data = await response.json();
      const rows = data.data || [];
      const rules = rows.slice(1).map((r) => ({
        id: r[0],
        stage: Number(r[2]),
        conditionField: r[3] || "",
        conditionOp: r[4] || "",
        conditionVal: r[5] || "",
        approverType: normalizeGeneratedApproverType(r[6]),
        approverValue: r[7] || ""
      }));
      rules.sort((a, b) => a.stage - b.stage);
      res.json({ rules });
    } catch (error) {
      console.error("Error fetching rules:", error);
      res.status(500).json({ error: "Failed to fetch rules" });
    }
  });
  app.post("/api/rules/:formType", authMiddleware, async (req, res) => {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const { formType } = req.params;
    const { rules } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true });
    try {
      const rows = rules.map((r) => [
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveRules", formType, rows })
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving rules:", error);
      res.status(500).json({ error: error.message });
    }
  });
  app.post("/api/submit-approval", authMiddleware, async (req, res) => {
    try {
      const { tickets } = req.body;
      const firstTicket = tickets?.[0];
      if (!firstTicket) return res.status(400).json({ error: "Missing ticket payload" });
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const applicantEmail = req.user.email;
      const applicantName = req.user.name;
      const department = req.user.dept;
      const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
      if (!scriptUrl) {
        const mockId = `${firstTicket.formType || "AP"}${extractDeptCode(department)}${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "")}001`;
        return res.json({ success: true, generatedIds: [mockId], applicationNumber: mockId, source: "mock" });
      }
      const result = await postToAppsScript(scriptUrl, {
        action: "submitApplication",
        applicantEmail,
        applicantName,
        department,
        formType: firstTicket.formType,
        subject: firstTicket.subject || "",
        amount: firstTicket.amount || "",
        formData: firstTicket.formData || {}
      });
      return res.json({
        success: true,
        generatedIds: [result.applicationNumber],
        applicationNumber: result.applicationNumber,
        amlStatus: result.amlStatus
      });
    } catch (error) {
      console.error("Error submitting application:", error);
      return res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });
  const evaluateDynamicRules = (rules, currentStage, formData, formType, applicantEmail, usersData) => {
    const formRules = rules.filter((r) => r[1] === formType && Number(r[2]) > currentStage).sort((a, b) => Number(a[2]) - Number(b[2]));
    if (formRules.length === 0) return { stage: "END", approver: "" };
    const stages = [...new Set(formRules.map((r) => Number(r[2])))];
    for (const stage of stages) {
      const stageRules = formRules.filter((r) => Number(r[2]) === stage);
      for (const rule of stageRules) {
        const conditionField = rule[3];
        const conditionOp = rule[4];
        const conditionVal = rule[5];
        const approverType = rule[6];
        const approverValue = rule[7];
        let isMatch = false;
        if (conditionField === "ALWAYS" && String(conditionOp).toUpperCase() === "TRUE") {
          isMatch = true;
        } else {
          let actualVal = formData[conditionField];
          if (conditionOp === ">") isMatch = Number(actualVal) > Number(conditionVal);
          else if (conditionOp === "==") isMatch = String(actualVal) === String(conditionVal);
          else if (conditionOp === "IN") {
            const allowed = conditionVal.split(",").map((s) => s.trim());
            isMatch = allowed.includes(actualVal);
          }
        }
        if (isMatch) {
          let assignedApprover = "";
          const applicantRow = usersData.find((u) => u[0]?.toLowerCase() === applicantEmail.toLowerCase());
          if (approverType === "MANAGER") {
            assignedApprover = applicantRow ? applicantRow[3] : "";
          } else if (approverType === "ROLE") {
            assignedApprover = String(approverValue);
          } else {
            assignedApprover = String(approverValue);
          }
          if (assignedApprover) {
            let shouldSkip = false;
            if (approverType === "MANAGER" && assignedApprover.toLowerCase() === applicantEmail.toLowerCase()) {
              shouldSkip = true;
            }
            if (approverType === "ROLE" && applicantRow) {
              const myRoles = String(applicantRow[4] || "").split(",").map((s) => s.trim());
              if (myRoles.includes(assignedApprover)) {
                shouldSkip = true;
              }
            }
            if (shouldSkip) {
              break;
            }
          }
          return { stage: Number(stage), approver: assignedApprover };
        }
      }
    }
    return { stage: "END", approver: "" };
  };
  app.post("/api/tickets/:ticketId/resubmit", authMiddleware, async (req, res) => {
    const { ticketId } = req.params;
    const { formData = {}, amount, subject } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (ticketId.startsWith("DEMO-")) {
      await new Promise((resolve) => setTimeout(resolve, 800));
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
      const ticketRow = (ticketsData.data || []).find((r) => r[0] === ticketId);
      if (!ticketRow) throw new Error("Ticket not found");
      const formType = ticketRow[5];
      const applicantEmail = String(ticketRow[2] || "").toLowerCase();
      if (!isSameUserOrAdmin(applicantEmail, req.user)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (String(ticketRow[6] || "") !== "Rejected") {
        return res.status(400).json({ error: "Only rejected tickets can be resubmitted" });
      }
      const allRules = rulesData.data || [];
      const allUsers = usersData.data || [];
      const next = evaluateDynamicRules(allRules, 0, formData, formType, applicantEmail, allUsers);
      let newStatus = "Pending";
      let newStage = next.stage;
      let newApprover = next.approver;
      if (next.stage === "END") {
        newStatus = "Approved";
        newStage = "END";
        newApprover = "";
      }
      const response = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resubmitTicket",
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
    } catch (error) {
      console.error("Error resubmitting ticket:", error);
      res.status(500).json({ error: error.message });
    }
  });
  app.get("/api/tickets/my/:email", authMiddleware, async (req, res) => {
    const email = req.params.email.toLowerCase();
    if (!isSameUserOrAdmin(email, req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    const mockTickets = [
      { id: "DEMO-AP-001", createdAt: (/* @__PURE__ */ new Date()).toISOString(), applicantEmail: email, applicantName: "\u5C55\u793A\u6E2C\u8A66\u54E1", dept: "\u6E2C\u8A66\u90E8\u9580", formType: "AP", subject: "\u884C\u92B7\u5408\u4F5C\u5C08\u6848\u7C3D\u5448", amount: "", status: "Pending", stage: "1", currentApprover: "\u6797\u4E3B\u7BA1 - \u884C\u92B7\u90E8", formData: { apSubject: "\u884C\u92B7\u5408\u4F5C\u5C08\u6848\u7C3D\u5448", apDesc: "\u8AAA\u660E\u5167\u5BB9", external_collab: "true", ext_company_name: "\u5916\u90E8\u6E2C\u8A66\u516C\u53F8" } },
      { id: "DEMO-CS-002", createdAt: new Date(Date.now() - 864e5).toISOString(), applicantEmail: email, applicantName: "\u5C55\u793A\u6E2C\u8A66\u54E1", dept: "\u6E2C\u8A66\u90E8\u9580", formType: "CS", subject: "\u7D93\u6FDF\u90E8\u8B8A\u66F4\u767B\u8A18\u7528\u5370", amount: "", status: "Approved", stage: "END", currentApprover: "", formData: { seal_type: "\u7D93\u6FDF\u90E8\u7AE0", cs_desc: "\u9700\u8981\u7528\u5370" } }
    ];
    if (!scriptUrl) {
      return res.json({ tickets: [mockTickets[0], mockTickets[1]], source: "mock" });
    }
    try {
      const [ticketsRes, usersRes] = await Promise.all([
        fetch(`${scriptUrl}?action=getData&sheet=Tickets`),
        fetch(`${scriptUrl}?action=getData&sheet=Users`)
      ]);
      const ticketsData = await ticketsRes.json();
      const usersData = await usersRes.json();
      const rows = ticketsData.data || [];
      const users = usersData.data || [];
      const getApproverDisplayName = (approverStr) => {
        if (!approverStr) return "";
        if (approverStr.startsWith("ROLE:")) {
          const roleMap = {
            "ROLE:ADMIN": "\u7CFB\u7D71\u7BA1\u7406\u54E1",
            "ROLE:FINANCE": "\u8CA1\u52D9\u90E8\u4E3B\u7BA1",
            "ROLE:GM": "\u7E3D\u7D93\u7406",
            "ROLE:LEGAL": "\u6CD5\u52D9\u90E8\u4E3B\u7BA1",
            "ROLE:CS_HEAD": "\u5BA2\u670D\u90E8\u4E3B\u7BA1"
          };
          return roleMap[approverStr] || approverStr;
        }
        const userRow = users.find((u) => u[0]?.toLowerCase() === approverStr.toLowerCase());
        if (userRow && userRow[1]) {
          const name = String(userRow[1]).split("(")[0].trim();
          const dept = userRow[2];
          return `${name} - ${dept}`;
        }
        return approverStr;
      };
      const myTickets = rows.slice(1).filter((r) => {
        return r[2]?.toLowerCase() === email;
      }).map((r) => ({
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
        currentApprover: getApproverDisplayName(r[13] || "")
      }));
      myTickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json({ tickets: myTickets });
    } catch (error) {
      console.error("Error fetching my tickets:", error);
      res.status(500).json({ error: "Failed to fetch my tickets" });
    }
  });
  app.get("/api/tickets/:ticketId/logs", authMiddleware, async (req, res) => {
    const { ticketId } = req.params;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl || ticketId.startsWith("DEMO-")) {
      return res.json({ logs: [
        { ticketId, action: "Submitted", approver: "applicant@company.com", stage: "0", comment: "\u767C\u8D77\u7533\u8ACB", timestamp: new Date(Date.now() - 864e5).toISOString() },
        { ticketId, action: "Approved", approver: "boss@company.com", stage: "1", comment: "\u540C\u610F", timestamp: new Date(Date.now() - 36e5).toISOString() }
      ] });
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
  app.get("/api/backoffice/tickets", authMiddleware, async (req, res) => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!canAccessBackoffice(req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!scriptUrl) {
      return res.json({ tickets: [], source: "mock" });
    }
    try {
      const response = await fetch(`${scriptUrl}?action=getData&sheet=Tickets`);
      const data = await response.json();
      const rows = data.data || [];
      const tickets = rows.slice(1).map((row) => ({
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
        currentApprover: row[13] || ""
      })).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json({ tickets });
    } catch (error) {
      console.error("Error fetching backoffice tickets:", error);
      res.status(500).json({ error: error.message || "Failed to fetch backoffice tickets" });
    }
  });
  app.post("/api/tickets/:ticketId/complete", authMiddleware, async (req, res) => {
    if (!canAccessBackoffice(req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true, source: "mock" });
    try {
      const result = await postToAppsScript(scriptUrl, {
        action: "completeTicket",
        ticketId: req.params.ticketId,
        completedBy: req.user?.email,
        note: req.body?.note || ""
      });
      res.json(result);
    } catch (error) {
      console.error("Error completing ticket:", error);
      res.status(500).json({ error: error.message || "Failed to complete ticket" });
    }
  });
  app.get("/api/meeting-rooms", authMiddleware, async (req, res) => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.json({
        rooms: [
          { id: "ROOM-5F", name: "5F\u6703\u8B70\u5BA4", location: "5F", capacity: "8", isActive: true, sortOrder: 1, openTime: "09:00", closeTime: "18:00" },
          { id: "ROOM-11F", name: "11F\u6703\u8B70\u5BA4", location: "11F", capacity: "12", isActive: true, sortOrder: 2, openTime: "09:00", closeTime: "18:00" }
        ],
        source: "mock"
      });
    }
    try {
      const response = await fetch(`${scriptUrl}?action=getData&sheet=MeetingRooms`);
      const data = await response.json();
      const rows = data.data || [];
      const rooms = rows.slice(1).map(mapMeetingRoom).filter((room) => room.id).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-Hant"));
      res.json({ rooms });
    } catch (error) {
      console.error("Error fetching meeting rooms:", error);
      res.status(500).json({ error: error.message || "Failed to fetch meeting rooms" });
    }
  });
  app.post("/api/meeting-rooms", authMiddleware, async (req, res) => {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const roomId = String(req.body.id || `ROOM-${Date.now()}`).trim();
    const roomName = String(req.body.name || "").trim();
    if (!roomName) return res.status(400).json({ error: "\u6703\u8B70\u5BA4\u540D\u7A31\u5FC5\u586B" });
    if (!scriptUrl) return res.json({ success: true, source: "mock" });
    try {
      const result = await postToAppsScript(scriptUrl, {
        action: "saveMeetingRoom",
        room: {
          id: roomId,
          name: roomName,
          location: String(req.body.location || "").trim(),
          capacity: String(req.body.capacity || "").trim(),
          isActive: parseActiveFlag(req.body.isActive),
          sortOrder: String(req.body.sortOrder || ""),
          openTime: "09:00",
          closeTime: "18:00",
          createdAt: req.body.createdAt || now
        }
      });
      res.json(result);
    } catch (error) {
      console.error("Error saving meeting room:", error);
      res.status(500).json({ error: error.message || "Failed to save meeting room" });
    }
  });
  app.get("/api/meeting-bookings", authMiddleware, async (req, res) => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    const startDate = String(req.query.startDate || "");
    const endDate = String(req.query.endDate || "");
    const mineOnly = req.query.mine === "true";
    if (!scriptUrl) return res.json({ bookings: [], source: "mock" });
    try {
      const response = await fetch(`${scriptUrl}?action=getData&sheet=MeetingBookings`);
      const data = await response.json();
      const rows = data.data || [];
      const bookings = rows.slice(1).map(mapMeetingBooking).filter((booking) => booking.id).filter((booking) => booking.status !== "Cancelled").filter((booking) => !startDate || booking.date >= startDate).filter((booking) => !endDate || booking.date <= endDate).filter((booking) => !mineOnly || String(booking.bookerEmail).toLowerCase() === req.user?.email.toLowerCase()).sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
      res.json({ bookings });
    } catch (error) {
      console.error("Error fetching meeting bookings:", error);
      res.status(500).json({ error: error.message || "Failed to fetch meeting bookings" });
    }
  });
  app.post("/api/meeting-bookings", authMiddleware, async (req, res) => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true, booking: { id: `MB${Date.now()}`, ...req.body }, source: "mock" });
    try {
      const result = await postToAppsScript(scriptUrl, {
        action: "createMeetingBooking",
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
    } catch (error) {
      console.error("Error creating meeting booking:", error);
      res.status(500).json({ error: error.message || "Failed to create meeting booking" });
    }
  });
  app.post("/api/meeting-bookings/:bookingId/cancel", authMiddleware, async (req, res) => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true, source: "mock" });
    try {
      const result = await postToAppsScript(scriptUrl, {
        action: "cancelMeetingBooking",
        bookingId: req.params.bookingId,
        cancelledBy: req.user?.email,
        isAdmin: isAdminUser(req.user)
      });
      res.json(result);
    } catch (error) {
      console.error("Error cancelling meeting booking:", error);
      res.status(500).json({ error: error.message || "Failed to cancel meeting booking" });
    }
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });
  return app;
}
export {
  createApp
};
