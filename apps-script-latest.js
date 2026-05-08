/* =========================================
 * 企業線上簽核系統 - Google Apps Script 後端 V6 真實流程版
 * 包含：動態表單、規則引擎、簽核歷史紀錄(Audit Log)
 * =========================================
 * 
 * ⚠️ 部署提醒：
 * 每次修改此程式碼後，一定要執行以下步驟才能在正式環境生效：
 * 「部署」 -> 「管理部署作業」 -> 點擊右上角「編輯(鉛筆)」 
 *  -> 版本下拉選單選擇：「建立新版本」 -> 點擊「部署」
 * ========================================= */

// 處理所有的 GET 請求
function doGet(e) {
  try {
    var action = e.parameter.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'getUser') {
      var email = e.parameter.email;
      if (!email) return createJsonResponse({ success: false, error: "Missing email parameter" });
      var userSheet = ss.getSheetByName("Users");
      if (!userSheet) return createJsonResponse({ success: false, error: "Users sheet not found" });
      var data = userSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().toLowerCase() === email.toLowerCase()) {
          return createJsonResponse({ 
            success: true, 
            user: { email: data[i][0], name: data[i][1], dept: data[i][2], manager: data[i][3], roles: data[i][4] || '' } 
          });
        }
      }
      return createJsonResponse({ success: false, error: "User not found" });
    }

    if (action === 'getData') {
      var sheetName = e.parameter.sheet;
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) return createJsonResponse({ success: false, error: "Sheet not found: " + sheetName });
      return createJsonResponse({ success: true, data: sheet.getDataRange().getValues() });
    }

    if (action === 'getRules') {
      var formType = e.parameter.formType;
      var ruleSheet = ss.getSheetByName("WorkflowRules");
      if (!ruleSheet) return createJsonResponse({ success: false, error: "WorkflowRules sheet not found" });
      var data = ruleSheet.getDataRange().getValues();
      var filteredData = [data[0]]; 
      for (var i = 1; i < data.length; i++) {
        if (data[i][1] === formType) filteredData.push(data[i]);
      }
      return createJsonResponse({ success: true, data: filteredData });
    }

    if (action === 'getFormTypes') {
      var formSheet = ss.getSheetByName("FormTypes");
      if (!formSheet) {
        return createJsonResponse({ success: true, data: [["FormID", "FormName"], ["AP", "簽呈單 (AP)"], ["RD", "請款單 (RD)"], ["CS", "用印申請單 (CS)"]] });
      }
      return createJsonResponse({ success: true, data: formSheet.getDataRange().getValues() });
    }

    if (action === 'getSetting') {
      var key = e.parameter.key;
      var settingsSheet = ss.getSheetByName("SystemSettings");
      if (!settingsSheet) return createJsonResponse({ success: true, key: key, value: "" });
      var settingsData = settingsSheet.getDataRange().getValues();
      for (var s = 1; s < settingsData.length; s++) {
        if (String(settingsData[s][0]) === String(key)) {
          return createJsonResponse({ success: true, key: key, value: settingsData[s][1] || "" });
        }
      }
      return createJsonResponse({ success: true, key: key, value: "" });
    }

    // 取得特定單據的簽核歷史紀錄
    if (action === 'getAuditLogs') {
      var ticketId = e.parameter.ticketId;
      var logSheet = ss.getSheetByName("AuditLogs");
      if (!logSheet) return createJsonResponse({ success: false, error: "AuditLogs sheet not found" });
      var data = logSheet.getDataRange().getValues();
      var logs = [];
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === ticketId) {
          logs.push({
            ticketId: data[i][0],
            action: data[i][1],
            approver: data[i][2],
            stage: data[i][3],
            comment: data[i][4],
            timestamp: data[i][5]
          });
        }
      }
      return createJsonResponse({ success: true, data: logs });
    }

    return createJsonResponse({ success: false, error: "Unknown GET action: " + action });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

// 處理所有的 POST 請求
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ success: false, error: "Empty POST data" });
    }

    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. 提交新單據 (Tickets) 且寫入提出申請的 Log
    if (action === 'submitTickets') {
      var sheet = ss.getSheetByName("Tickets");
      var logSheet = ss.getSheetByName("AuditLogs");
      if (!sheet) return createJsonResponse({ success: false, error: "Tickets sheet not found" });
      var rows = payload.rows;
      var generatedIds = [];
      if (rows && rows.length > 0) {
        for (var r = 0; r < rows.length; r++) {
          rows[r][0] = generateTicketNumber_(sheet, rows[r][5], rows[r][4], rows[r][0]);
          generatedIds.push(rows[r][0]);
        }
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
        
        // 寫入申請軌跡
        if (logSheet) {
          var logs = rows.map(function(r) { return [r[0], "Submitted", r[2], "0", "發起申請", r[1]]; });
          logSheet.getRange(logSheet.getLastRow() + 1, 1, logs.length, logs[0].length).setValues(logs);
        }
      }
      return createJsonResponse({ success: true, generatedIds: generatedIds });
    }

    // 2. 儲存規則
    if (action === 'saveRules') {
      var formType = payload.formType;
      var newRows = payload.rows;
      var sheet = ss.getSheetByName("WorkflowRules");
      if (!sheet) return createJsonResponse({ success: false, error: "WorkflowRules sheet not found" });
      var data = sheet.getDataRange().getValues();
      for (var i = data.length - 1; i >= 1; i--) {
        if (data[i][1] === formType) sheet.deleteRow(i + 1);
      }
      if (newRows && newRows.length > 0) {
        var startRow = Math.max(2, sheet.getLastRow() + 1);
        sheet.getRange(startRow, 1, newRows.length, newRows[0].length).setValues(newRows);
      }
      return createJsonResponse({ success: true });
    }

    if (action === 'addFormType') {
      var formId = payload.formId;
      var formName = payload.formName;
      var sheet = ss.getSheetByName("FormTypes");
      if (!sheet) return createJsonResponse({ success: false, error: "FormTypes sheet not found" });
      sheet.appendRow([formId, formName]);
      return createJsonResponse({ success: true });
    }

    // 通用的 Upsert (更新或新增) 功能
    if (action === 'saveData') {
      var sheetName = payload.sheet;
      var matchCol = payload.matchColumn; // 1-indexed
      var matchVal = payload.matchValue;
      var newRow = payload.row;
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) return createJsonResponse({ success: false, error: sheetName + " sheet not found" });
      
      var data = sheet.getDataRange().getValues();
      var rowIndex = -1;
      for (var i = 1; i < data.length; i++) {
        if (data[i][matchCol - 1] == matchVal) {
          rowIndex = i + 1;
          break;
        }
      }
      
      if (rowIndex !== -1) {
        sheet.getRange(rowIndex, 1, 1, newRow.length).setValues([newRow]);
      } else {
        sheet.appendRow(newRow);
      }
      return createJsonResponse({ success: true });
    }

    if (action === 'saveSetting') {
      var settingsKey = payload.key;
      var settingsValue = payload.value;
      var settingsSheet = ss.getSheetByName("SystemSettings");
      if (!settingsSheet) return createJsonResponse({ success: false, error: "SystemSettings sheet not found" });

      var settingsRows = settingsSheet.getDataRange().getValues();
      var settingsRowIndex = -1;
      for (var sr = 1; sr < settingsRows.length; sr++) {
        if (String(settingsRows[sr][0]) === String(settingsKey)) {
          settingsRowIndex = sr + 1;
          break;
        }
      }

      if (settingsRowIndex !== -1) {
        settingsSheet.getRange(settingsRowIndex, 1, 1, 2).setValues([[settingsKey, settingsValue]]);
      } else {
        settingsSheet.appendRow([settingsKey, settingsValue]);
      }

      return createJsonResponse({ success: true });
    }

    if (action === 'updateTicketActionProxy') {
      return createJsonResponse({ success: false, error: 'GitHub Pages 直連模式下，簽核 action 仍需透過 Node server 的 /api/tickets/:ticketId/action 執行規則判斷。' });
    }

    // 4. 更新單據狀態 (主管核准/駁回) 並寫入歷史紀錄
    if (action === 'updateTicket') {
      var ticketId = payload.ticketId;
      var newStatus = payload.status;
      var newStage = payload.stage;
      var nextApprover = payload.nextApprover;
      var comment = payload.comment; 
      var actionType = payload.actionType; // 'approve' or 'reject'
      var approverEmail = payload.approverEmail;
      var compliance = payload.compliance || null;
      
      var sheet = ss.getSheetByName("Tickets");
      var logSheet = ss.getSheetByName("AuditLogs");
      if (!sheet) return createJsonResponse({ success: false, error: "Tickets sheet not found" });
      
      var data = sheet.getDataRange().getValues();
      var rowIndex = -1;
      var currentStageLabel = '';
      
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === ticketId) {
          rowIndex = i + 1;
          currentStageLabel = data[i][7]; // 原本的 Stage
          break;
        }
      }
      
      if (rowIndex === -1) return createJsonResponse({ success: false, error: "Ticket ID not found: " + ticketId });
      
      sheet.getRange(rowIndex, 7).setValue(newStatus);
      sheet.getRange(rowIndex, 8).setValue(newStage);
      sheet.getRange(rowIndex, 14).setValue(nextApprover);
      if (compliance) {
        sheet.getRange(rowIndex, 15).setValue(compliance.aml_result || '');
        sheet.getRange(rowIndex, 16).setValue(compliance.aml_comment || '');
        sheet.getRange(rowIndex, 17).setValue(compliance.rp_result || '');
        sheet.getRange(rowIndex, 18).setValue(compliance.rp_comment || '');
      }

      // 寫入 Log
      if (logSheet) {
        var logAction = actionType === 'approve' ? 'Approved' : 'Rejected';
        logSheet.appendRow([
          ticketId, 
          logAction, 
          approverEmail, 
          currentStageLabel, 
          comment || '', 
          new Date().toISOString()
        ]);
      }

      return createJsonResponse({ success: true });
    }

    return createJsonResponse({ success: false, error: "Unknown POST action: " + action });

  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// 👉 請在 Google Apps Script 上方選單選擇此函式並按下「執行」，即可自動長出所有真實版的規則與表單設定！
function setupRealData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  var _checkAndCreate = function(name, headers) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#d9ead3");
    }
    return sheet;
  };
  
  _checkAndCreate("Users", ["Email", "Name", "Department", "ManagerEmail", "Roles"]);
  _checkAndCreate("Tickets", ["TicketID", "CreatedAt", "ApplicantEmail", "ApplicantName", "Department", "FormType", "Status", "CurrentStage", "SLA_Deadline", "Subject", "Amount", "NeedsAML", "FormData_JSON", "CurrentApprover", "AML_Result", "AML_Comment", "RP_Result", "RP_Comment"]);
  var formsSheet = _checkAndCreate("FormTypes", ["FormID", "FormName"]);
  var rulesSheet = _checkAndCreate("WorkflowRules", ["RuleID", "FormType", "Stage", "ConditionField", "ConditionOp", "ConditionVal", "ApproverType", "ApproverValue"]);
  _checkAndCreate("AuditLogs", ["TicketID", "ActionType", "ApproverID", "Stage", "Comment", "Timestamp"]);
  _checkAndCreate("FormDefinitions", ["FormID", "FieldsMarkdown", "LogicMarkdown", "ConfigJSON"]);
  _checkAndCreate("SystemSettings", ["Key", "Value"]);

  // 清空並寫入真實表單種類
  formsSheet.getRange(2, 1, formsSheet.getLastRow() || 2, 2).clearContent();
  formsSheet.getRange(2, 1, 3, 2).setValues([
    ["AP", "簽呈單 (AP)"],
    ["RD", "請款單 (RD)"],
    ["CS", "用印申請單 (CS)"]
  ]);

  // 清空並寫入貴公司真實的流程規則
  var ruleData = [
    // 簽呈單 AP
    // [RuleID, FormType, Stage, ConditionField, ConditionOp, ConditionVal, ApproverType, ApproverValue]
    ["AP_1", "AP", 1, "ALWAYS", "TRUE", "", "MANAGER", ""], // 直屬主管
    ["AP_2", "AP", 2, "ALWAYS", "TRUE", "", "ROLE", "ROLE:DEPT_HEAD"], // 本部部長
    ["AP_3", "AP", 3, "external_collab", "==", "true", "SPECIAL:AML_CHECK", "ROLE:ADMIN_HEAD"], // 管理處處長 (需 AML)
    ["AP_4", "AP", 4, "ALWAYS", "TRUE", "", "ROLE", "ROLE:ADMIN_GM"], // 管理本部長
    ["AP_5", "AP", 5, "ALWAYS", "TRUE", "", "ROLE", "ROLE:GM"], // 總經理
    
    // 請款單 RD
    ["RD_1", "RD", 1, "ALWAYS", "TRUE", "", "MANAGER", ""],
    ["RD_2", "RD", 2, "ALWAYS", "TRUE", "", "ROLE", "ROLE:DEPT_HEAD"],
    ["RD_3", "RD", 3, "amount", ">", "5000", "ROLE", "ROLE:ADMIN_GM"],
    ["RD_4", "RD", 4, "amount", ">", "5000", "ROLE", "ROLE:GM"],

    // 用印申請單 CS
    ["CS_1", "CS", 1, "ALWAYS", "TRUE", "", "MANAGER", ""],
    ["CS_2", "CS", 2, "ALWAYS", "TRUE", "", "ROLE", "ROLE:DEPT_HEAD"],
    // 用印陣列比對 ("IN" condition)
    ["CS_3", "CS", 3, "seal_type", "IN", "經濟部章,銀行用章,法務章,合約便章", "ROLE", "ROLE:ADMIN_GM"],
    ["CS_4", "CS", 4, "seal_type", "IN", "經濟部章,銀行用章,法務章,合約便章", "ROLE", "ROLE:GM"],
    ["CS_5", "CS", 5, "seal_type", "IN", "經濟部章,銀行用章,法務章,合約便章", "ROLE", "ROLE:BIG_SEAL_MGR"], // 大章管理人
    ["CS_6", "CS", 6, "seal_type", "IN", "經濟部章,銀行用章,法務章,合約便章", "ROLE", "ROLE:SMALL_SEAL_MGR"] // 小章管理人
  ];
  
  rulesSheet.getRange(2, 1, rulesSheet.getLastRow() || 2, 8).clearContent();
  rulesSheet.getRange(2, 1, ruleData.length, 8).setValues(ruleData);

  try {
    SpreadsheetApp.getUi().alert("成功匯入貴公司真實的【表單定義】與【簽核路徑規則表】，並建立了 AuditLogs 工作表！");
  } catch (e) {
    Logger.log("成功匯入貴公司真實的【表單定義】與【簽核路徑規則表】，並建立了 AuditLogs 工作表！");
  }
}

function generateTicketNumber_(sheet, formType, department, fallbackId) {
  if (fallbackId && String(fallbackId).length >= 10) return fallbackId;

  var deptMatch = String(department || '').match(/^([A-Za-z0-9]+)/);
  var deptCode = deptMatch ? deptMatch[1].toUpperCase() : 'GEN';
  var now = new Date();
  var yyyymmdd = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');
  return String(formType || 'AP').toUpperCase() + deptCode + yyyymmdd + randomSuffix_();
}

function randomSuffix_() {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var suffix = '';
  for (var i = 0; i < 4; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return suffix;
}
