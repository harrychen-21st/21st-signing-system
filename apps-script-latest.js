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

var SPREADSHEET_ID_PROPERTY_KEY = 'SPREADSHEET_ID';

function getSpreadsheet_() {
  var scriptProperties = PropertiesService.getScriptProperties();
  var spreadsheetId = String(scriptProperties.getProperty(SPREADSHEET_ID_PROPERTY_KEY) || '').trim();

  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) {
    return activeSpreadsheet;
  }

  throw new Error('Spreadsheet not configured. Set script property SPREADSHEET_ID to the target spreadsheet ID.');
}

function getSpreadsheetInfo_() {
  var ss = getSpreadsheet_();
  return {
    id: ss.getId(),
    name: ss.getName(),
    url: ss.getUrl()
  };
}

// 處理所有的 GET 請求
function doGet(e) {
  try {
    var action = e.parameter.action;
    var ss = getSpreadsheet_();

    if (action === 'healthcheck') {
      return createJsonResponse({ success: true, spreadsheet: getSpreadsheetInfo_() });
    }

    if (action === 'getUser') {
      var email = e.parameter.email;
      if (!email) return createJsonResponse({ success: false, error: "Missing email parameter" });
      var userSheet = ss.getSheetByName("Users");
      if (!userSheet) return createJsonResponse({ success: false, error: "Users sheet not found" });
      var data = userSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().trim().toLowerCase() === email.trim().toLowerCase()) {
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
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // 嘗試鎖定，最多等待 10 秒
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ success: false, error: "Empty POST data" });
    }

    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    var ss = getSpreadsheet_();

    if (action === 'submitApplication') {
      var now = new Date();
      var formData = payload.formData || {};
      var applicationNumber = generateApplicationNumber_(ss, payload.formType, payload.department, now);
      var amlResult = syncAmlInvestigation_(ss, {
        createdAt: now,
        formType: payload.formType,
        applicationNumber: applicationNumber,
        companyCode: getSetting_(ss, 'DEFAULT_COMPANY_CODE', '21CD'),
        department: payload.department,
        merchantName: formData.ext_company_name || '',
        taxId: formData.ext_tax_id || '',
        ownerName: formData.ext_company_owner || ''
      });

      var status = 'Submitted';
      if (formData.external_collab === '是') {
        status = amlResult.needsInvestigation ? 'Checking' : 'Submitted';
      }

      var ticketsSheet = ensureSheet_(ss, 'Tickets', [
        'TicketID', 'CreatedAt', 'ApplicantEmail', 'ApplicantName', 'Department', 'FormType',
        'Status', 'CurrentStage', 'SLA_Deadline', 'Subject', 'Amount', 'NeedsAML',
        'FormData_JSON', 'CurrentApprover'
      ]);

      ticketsSheet.appendRow([
        applicationNumber,
        now.toISOString(),
        payload.applicantEmail || '',
        payload.applicantName || '',
        payload.department || '',
        payload.formType || '',
        status,
        '',
        '',
        payload.subject || '',
        payload.amount || '',
        formData.external_collab === '是' ? 'TRUE' : 'FALSE',
        JSON.stringify(formData),
        ''
      ]);

      var logSheet = ensureSheet_(ss, 'AuditLogs', ['TicketID', 'ActionType', 'ApproverID', 'Stage', 'Comment', 'Timestamp']);
      logSheet.appendRow([applicationNumber, 'Submitted', payload.applicantEmail || '', '0', '送出申請', now.toISOString()]);

      sendApplicantSubmittedEmail_({
        to: payload.applicantEmail,
        applicantName: payload.applicantName,
        applicationNumber: applicationNumber,
        formType: payload.formType,
        subject: payload.subject,
        createdAt: now
      });

      return createJsonResponse({
        success: true,
        applicationNumber: applicationNumber,
        amlStatus: amlResult
      });
    }

    if (action === 'completeTicket') {
      var completeResult = completeTicket_(ss, payload.ticketId, payload.completedBy, payload.note);
      return createJsonResponse({ success: true, ticket: completeResult });
    }

    // 1. 提交新單據 (Tickets) 且寫入提出申請的 Log
    if (action === 'submitTickets') {
      var sheet = ss.getSheetByName("Tickets");
      var logSheet = ss.getSheetByName("AuditLogs");
      if (!sheet) return createJsonResponse({ success: false, error: "Tickets sheet not found" });
      var rows = payload.rows;
      if (rows && rows.length > 0) {
        var data = sheet.getDataRange().getValues();
        var generatedIds = [];
        
        for (var i = 0; i < rows.length; i++) {
          var formType = rows[i][5]; // F: FormType
          var dept = rows[i][4]; // E: Department
          var deptCode = (dept.split(';')[0] || 'XX').toUpperCase().trim();
          var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Taipei", "yyyyMMdd");
          var prefix = formType + deptCode + todayStr;
          
          var maxSeq = 0;
          for (var j = 1; j < data.length; j++) {
            var existingId = data[j][0] ? data[j][0].toString() : "";
            if (existingId.indexOf(prefix) === 0) {
              var seqStr = existingId.substring(prefix.length);
              var seqNum = parseInt(seqStr, 10);
              if (!isNaN(seqNum) && seqNum > maxSeq) {
                maxSeq = seqNum;
              }
            }
          }
          
          var newSeq = maxSeq + 1;
          var newId = prefix + ("000" + newSeq).slice(-3); // pad 3 digits
          
          rows[i][0] = newId; // Update ID in the row
          generatedIds.push(newId);
          data.push([newId]); // Update memory state for next row in this payload
        }
        
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
        
        // 寫入申請軌跡
        if (logSheet) {
          var logs = rows.map(function(r) { return [r[0], "Submitted", r[2], "0", "發起申請", r[1]]; });
          logSheet.getRange(logSheet.getLastRow() + 1, 1, logs.length, logs[0].length).setValues(logs);
        }
        return createJsonResponse({ success: true, generatedIds: generatedIds });
      }
      return createJsonResponse({ success: true });
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
      var rows = sheet.getDataRange().getValues();
      var targetRow = -1;
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || '').trim() === String(formId || '').trim()) {
          targetRow = i + 1;
          break;
        }
      }
      if (targetRow > 0) {
        sheet.getRange(targetRow, 1, 1, 2).setValues([[formId, formName]]);
      } else {
        sheet.appendRow([formId, formName]);
      }
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

    // 4. 更新單據狀態 (主管核准/駁回) 並寫入歷史紀錄
    if (action === 'updateTicket') {
      var ticketId = payload.ticketId;
      var newStatus = payload.status;
      var newStage = payload.stage;
      var nextApprover = payload.nextApprover;
      var comment = payload.comment; 
      var actionType = payload.actionType; // 'approve' or 'reject'
      var approverEmail = payload.approverEmail;
      var newFormData = payload.formData; // ADDED: 允許更新動態資料
      
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

      // 若有新資料 (例如 AML 調查結果)，更新回 FormData
      if (newFormData) {
        sheet.getRange(rowIndex, 13).setValue(JSON.stringify(newFormData));
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

    // 5. 重新送出單據 (更新內容並回到 Pending 狀態)
    if (action === 'resubmitTicket') {
      var ticketId = payload.ticketId;
      var newStatus = payload.status;
      var newStage = payload.stage;
      var nextApprover = payload.nextApprover;
      var newSubject = payload.subject;
      var newAmount = payload.amount;
      var newFormData = payload.formData;
      var approverEmail = payload.approverEmail;
      
      var sheet = ss.getSheetByName("Tickets");
      var logSheet = ss.getSheetByName("AuditLogs");
      if (!sheet) return createJsonResponse({ success: false, error: "Tickets sheet not found" });
      
      var data = sheet.getDataRange().getValues();
      var rowIndex = -1;
      
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === ticketId) {
          rowIndex = i + 1;
          break;
        }
      }
      
      if (rowIndex === -1) return createJsonResponse({ success: false, error: "Ticket ID not found: " + ticketId });
      
      sheet.getRange(rowIndex, 7).setValue(newStatus);
      sheet.getRange(rowIndex, 8).setValue(newStage);
      sheet.getRange(rowIndex, 10).setValue(newSubject || '');
      sheet.getRange(rowIndex, 11).setValue(newAmount || '');
      sheet.getRange(rowIndex, 13).setValue(JSON.stringify(newFormData));
      sheet.getRange(rowIndex, 14).setValue(nextApprover);

      if (logSheet) {
        logSheet.appendRow([
          ticketId, 
          'Resubmitted', 
          approverEmail, 
          '0', 
          '重新編輯並送出', 
          new Date().toISOString()
        ]);
      }

      return createJsonResponse({ success: true });
    }

    return createJsonResponse({ success: false, error: "Unknown POST action: " + action });

  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  } finally {
    if (lock) {
      lock.releaseLock();
    }
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// 👉 請在 Google Apps Script 上方選單選擇此函式並按下「執行」，即可自動長出所有真實版的規則與表單設定！
function ensureSheet_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9ead3');
    return sheet;
  }
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  return sheet;
}

function getSetting_(ss, key, fallback) {
  var sheet = ss.getSheetByName('SystemSettings');
  if (!sheet) return fallback;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === key) {
      return String(values[i][1] || '').trim() || fallback;
    }
  }
  return fallback;
}

function setDefaultSetting_(sheet, key, value) {
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === key) return;
  }
  sheet.appendRow([key, value]);
}

function extractDeptCode_(department) {
  var match = String(department || '').trim().match(/^[A-Za-z0-9]+/);
  return (match ? match[0] : 'XX').toUpperCase();
}

function generateApplicationNumber_(ss, formType, department, now) {
  var sheet = ensureSheet_(ss, 'Tickets', ['TicketID', 'CreatedAt', 'ApplicantEmail', 'ApplicantName', 'Department', 'FormType', 'Status', 'CurrentStage', 'SLA_Deadline', 'Subject', 'Amount', 'NeedsAML', 'FormData_JSON', 'CurrentApprover']);
  var dateText = Utilities.formatDate(now, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyyMMdd');
  var prefix = String(formType || 'AP').toUpperCase() + extractDeptCode_(department) + dateText;
  var values = sheet.getDataRange().getValues();
  var maxSeq = 0;
  for (var i = 1; i < values.length; i++) {
    var existingId = String(values[i][0] || '');
    if (existingId.indexOf(prefix) === 0) {
      var seq = parseInt(existingId.substring(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return prefix + String(maxSeq + 1).padStart(3, '0');
}

function normalizeHeader_(header) {
  var value = String(header || '').trim();
  var aliases = { '需求者': '需求單位', '商家': '商家名稱', '統編': '統一編號' };
  return aliases[value] || value;
}

function mapHeaderIndexes_(headers) {
  var indexes = {};
  for (var i = 0; i < headers.length; i++) indexes[normalizeHeader_(headers[i])] = i;
  return indexes;
}

function findPreviousAmlRecord_(sheet, taxId) {
  if (!taxId || sheet.getLastRow() < 2) return null;
  var values = sheet.getDataRange().getValues();
  var indexes = mapHeaderIndexes_(values[0]);
  var taxIndex = indexes['統一編號'];
  var adminIndex = indexes['通知管理處查詢'];
  var riskIndex = indexes['通知風控查詢'];
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][taxIndex] || '').trim() === String(taxId).trim()) {
      return {
        adminStatus: adminIndex == null ? '' : String(values[i][adminIndex] || '').trim(),
        riskStatus: riskIndex == null ? '' : String(values[i][riskIndex] || '').trim()
      };
    }
  }
  return null;
}

function syncAmlInvestigation_(ss, record) {
  if (!record.taxId) return { skipped: true, reason: 'No tax ID' };
  var amlSheetId = getSetting_(ss, 'AML_SHEET_ID', '1DBnDX8xyLIGhXB-EWjIIeCgmCsoP7pWD0kbryG4rCq4');
  var amlSs = SpreadsheetApp.openById(amlSheetId);
  var sheet = amlSs.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['填表日期', '表單類型', '表單編號', '公司別', '需求單位', '商家名稱', '統一編號', '負責人姓名', '通知管理處查詢', '通知風控查詢']);
  }
  var values = sheet.getDataRange().getValues();
  var previous = findPreviousAmlRecord_(sheet, record.taxId);
  var adminStatus = previous && previous.adminStatus === '已調查' ? '已調查' : '已通知待調查';
  var riskStatus = previous && previous.riskStatus === '已調查' ? '已調查' : '已通知待調查';
  var needsInvestigation = adminStatus !== '已調查' || riskStatus !== '已調查';
  var dataByHeader = {
    '填表日期': Utilities.formatDate(record.createdAt, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss'),
    '表單類型': record.formType,
    '表單編號': record.applicationNumber,
    '公司別': record.companyCode,
    '需求單位': record.department,
    '需求者': record.department,
    '商家名稱': record.merchantName,
    '商家': record.merchantName,
    '統一編號': record.taxId,
    '統編': record.taxId,
    '負責人姓名': record.ownerName,
    '通知管理處查詢': adminStatus,
    '通知風控查詢': riskStatus
  };
  var headers = values[0];
  var row = headers.map(function(header) {
    return dataByHeader[normalizeHeader_(header)] || dataByHeader[String(header).trim()] || '';
  });
  sheet.appendRow(row);
  if (needsInvestigation) sendInvestigationEmails_(ss, record, adminStatus, riskStatus);
  return { needsInvestigation: needsInvestigation, adminStatus: adminStatus, riskStatus: riskStatus };
}

function parseEmailList_(value) {
  return String(value || '').split(',').map(function(email) { return email.trim(); }).filter(Boolean);
}

function sendInvestigationEmails_(ss, record, adminStatus, riskStatus) {
  var adminEmails = adminStatus === '已調查' ? [] : parseEmailList_(getSetting_(ss, 'ADMIN_CHECK_EMAILS', ''));
  var riskEmails = riskStatus === '已調查' ? [] : parseEmailList_(getSetting_(ss, 'RISK_CHECK_EMAILS', ''));
  var recipients = adminEmails.concat(riskEmails);
  if (!recipients.length) return;
  var body = [
    '請協助進行 AML / 關係人調查。',
    '',
    '表單編號：' + record.applicationNumber,
    '表單類型：' + record.formType,
    '需求單位：' + record.department,
    '公司別：' + record.companyCode,
    '商家名稱：' + record.merchantName,
    '統一編號：' + record.taxId,
    '負責人姓名：' + record.ownerName,
    '',
    '請至 AML/關係人調查 Google Sheet 完成調查後，將狀態調整為「已調查」。'
  ].join('\n');
  MailApp.sendEmail({ to: recipients.join(','), subject: 'AML/關係人調查通知 - ' + record.applicationNumber, body: body, name: '21CD 內部申請系統' });
}

function sendApplicantSubmittedEmail_(params) {
  if (!params.to) return;
  var body = [
    (params.applicantName || '您好') + '，您的申請已送出。',
    '',
    '表單編號：' + params.applicationNumber,
    '表單類型：' + params.formType,
    '主旨：' + (params.subject || '-'),
    '填表日期：' + Utilities.formatDate(params.createdAt, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss'),
    '',
    '請保留此編號，以利後續查詢。'
  ].join('\n');
  MailApp.sendEmail({ to: params.to, subject: '申請已送出 - ' + params.applicationNumber, body: body, name: '21CD 內部申請系統' });
}

function completeTicket_(ss, ticketId, completedBy, note) {
  var sheet = ss.getSheetByName('Tickets');
  if (!sheet) throw new Error('Tickets sheet not found');
  var values = sheet.getDataRange().getValues();
  var rowIndex = -1;
  var applicantEmail = '';
  var subject = '';
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0] || '') === String(ticketId || '')) {
      rowIndex = i + 1;
      applicantEmail = values[i][2];
      subject = values[i][9];
      break;
    }
  }
  if (rowIndex < 0) throw new Error('Ticket not found: ' + ticketId);
  sheet.getRange(rowIndex, 7).setValue('Completed');
  sheet.getRange(rowIndex, 14).setValue('');
  var logSheet = ensureSheet_(ss, 'AuditLogs', ['TicketID', 'ActionType', 'ApproverID', 'Stage', 'Comment', 'Timestamp']);
  logSheet.appendRow([ticketId, 'Completed', completedBy || '', 'END', note || '後台完成結案', new Date().toISOString()]);
  if (applicantEmail) {
    MailApp.sendEmail({
      to: applicantEmail,
      subject: '申請已完成 - ' + ticketId,
      body: ['您的申請已完成。', '', '表單編號：' + ticketId, '主旨：' + (subject || '-'), '備註：' + (note || '-')].join('\n'),
      name: '21CD 內部申請系統'
    });
  }
  return { id: ticketId, status: 'Completed' };
}

function setupRealData() {
  var ss = getSpreadsheet_();
  
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
  _checkAndCreate("Tickets", ["TicketID", "CreatedAt", "ApplicantEmail", "ApplicantName", "Department", "FormType", "Status", "CurrentStage", "SLA_Deadline", "Subject", "Amount", "NeedsAML", "FormData_JSON", "CurrentApprover"]);
  var formsSheet = _checkAndCreate("FormTypes", ["FormID", "FormName"]);
  var rulesSheet = _checkAndCreate("WorkflowRules", ["RuleID", "FormType", "Stage", "ConditionField", "ConditionOp", "ConditionVal", "ApproverType", "ApproverValue"]);
  _checkAndCreate("AuditLogs", ["TicketID", "ActionType", "ApproverID", "Stage", "Comment", "Timestamp"]);
  _checkAndCreate("FormDefinitions", ["FormID", "FieldsMarkdown", "LogicMarkdown", "ConfigJSON"]);
  var settingsSheet = _checkAndCreate("SystemSettings", ["Key", "Value"]);

  // 預設佈告欄內容
  var settingsData = settingsSheet.getDataRange().getValues();
  setDefaultSetting_(settingsSheet, "DEFAULT_COMPANY_CODE", "21CD");
  setDefaultSetting_(settingsSheet, "AML_SHEET_ID", "1DBnDX8xyLIGhXB-EWjIIeCgmCsoP7pWD0kbryG4rCq4");
  setDefaultSetting_(settingsSheet, "ADMIN_CHECK_EMAILS", "");
  setDefaultSetting_(settingsSheet, "RISK_CHECK_EMAILS", "");
  if (settingsData.length <= 1) {
    settingsSheet.appendRow(["NoticeBoard", "歡迎使用企業內部簽核系統！\n\n- 若有任何系統操作問題，請聯繫 [IT 資訊處](#)。\n- [點擊此處查看簽核流程規範文件](#)"]);
  }

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
    ["AP_1", "AP", 1, "ALWAYS", "TRUE", "", "MANAGER", ""],
    ["AP_2", "AP", 2, "ALWAYS", "TRUE", "", "ROLE", "ROLE:DEPT_HEAD"],
    ["AP_3", "AP", 3, "external_collab", "==", "是", "SPECIAL:AML_CHECK", "ROLE:ADMIN_DIRECTOR"],
    ["AP_4", "AP", 4, "ALWAYS", "TRUE", "", "ROLE", "ROLE:ADMIN_VP"],
    ["AP_5", "AP", 5, "ALWAYS", "TRUE", "", "ROLE", "ROLE:GM"],
    
    // 請款單 RD
    ["RD_1", "RD", 1, "ALWAYS", "TRUE", "", "MANAGER", ""],
    ["RD_2", "RD", 2, "ALWAYS", "TRUE", "", "ROLE", "ROLE:DEPT_HEAD"],
    ["RD_3", "RD", 3, "amount", ">", "5000", "ROLE", "ROLE:ADMIN_VP"],
    ["RD_4", "RD", 4, "amount", ">", "5000", "ROLE", "ROLE:GM"],

    // 用印申請單 CS
    ["CS_1", "CS", 1, "seal_type", "==", "合約便章", "ROLE", "ROLE:LEGAL"], // 若是合約便章，需先經法務處同意
    ["CS_2", "CS", 2, "ALWAYS", "TRUE", "", "MANAGER", ""], // 直屬主管
    ["CS_3", "CS", 3, "ALWAYS", "TRUE", "", "ROLE", "ROLE:DEPT_HEAD"], // 本部部長
    ["CS_4", "CS", 4, "seal_type", "IN", "經濟部章,銀行用章,法務章,合約便章", "ROLE", "ROLE:ADMIN_VP"], // 管理本部長 (不包含發票章，發票章會提早結案)
    ["CS_5", "CS", 5, "seal_type", "IN", "經濟部章,銀行用章,法務章,合約便章", "ROLE", "ROLE:GM"], // 總經理
    ["CS_6", "CS", 6, "seal_type", "IN", "經濟部章,銀行用章,法務章,合約便章", "ROLE", "ROLE:BIG_SEAL_MGR"], // 大章管理人
    ["CS_7", "CS", 7, "seal_type", "IN", "經濟部章,銀行用章,法務章,合約便章", "ROLE", "ROLE:SMALL_SEAL_MGR"] // 小章管理人
  ];
  
  rulesSheet.getRange(2, 1, rulesSheet.getLastRow() || 2, 8).clearContent();
  rulesSheet.getRange(2, 1, ruleData.length, 8).setValues(ruleData);

  // 寫入 AP 動態表單規格
  var formDefsSheet = ss.getSheetByName("FormDefinitions");
  var apConfig = {
    fields: [
      { id: "subject", label: "主旨", type: "text", required: true },
      { id: "description", label: "內容說明", type: "textarea", required: true },
      { id: "attachment", label: "附件上傳 (請貼上雲端連結)", type: "text", required: false },
      { id: "external_collab", label: "是否涉及外部合作廠商", type: "select", options: ["否", "是"], required: true },
      { id: "ext_tax_id", label: "統一編號/識別碼", type: "text", required: true, showIf: { field: "external_collab", value: "是" } },
      { id: "ext_company_name", label: "廠商名稱/公司名稱", type: "text", required: true, showIf: { field: "external_collab", value: "是" } },
      { id: "ext_company_owner", label: "負責人姓名", type: "text", required: true, showIf: { field: "external_collab", value: "是" } }
    ]
  };
  var rdConfig = {
    fields: [
      { id: "related_ticket", label: "相關單號 (搭配請/採購單號)", type: "text", required: false },
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
  };
  var csConfig = {
    fields: [
      { id: "related_ticket", label: "相關單號 (搭配請/採購單號)", type: "text", required: false },
      { id: "seal_type", label: "用印類別", type: "select", options: ["經濟部章", "銀行用章", "法務章", "發票章", "合約便章"], required: true },
      { id: "description", label: "用印文件說明", type: "textarea", required: true },
      { id: "attachment", label: "用印文件草稿 (請貼上雲端連結)", type: "text", required: true }
    ]
  };

  // Upsert Definitions
  var defsData = formDefsSheet.getDataRange().getValues();
  var updateDef = function(formId, config) {
    var found = false;
    for (var d = 1; d < defsData.length; d++) {
      if (defsData[d][0] === formId) {
        formDefsSheet.getRange(d + 1, 4).setValue(JSON.stringify(config));
        found = true;
        break;
      }
    }
    if (!found) {
      formDefsSheet.appendRow([formId, "", "", JSON.stringify(config)]);
    }
  };

  updateDef('AP', apConfig);
  updateDef('RD', rdConfig);
  updateDef('CS', csConfig);

  SpreadsheetApp.getUi().alert("成功匯入貴公司真實的【表單定義】與【簽核路徑規則表】，並建立了 AuditLogs 工作表！");
}

function setSpreadsheetId(spreadsheetId) {
  var normalizedId = String(spreadsheetId || '').trim();
  if (!normalizedId) {
    throw new Error('Missing spreadsheetId');
  }

  PropertiesService.getScriptProperties().setProperty(SPREADSHEET_ID_PROPERTY_KEY, normalizedId);

  var ss = SpreadsheetApp.openById(normalizedId);
  try {
    SpreadsheetApp.getUi().alert('已設定 Spreadsheet ID: ' + normalizedId + '\n工作表: ' + ss.getName());
  } catch (e) {
    Logger.log('Configured Spreadsheet ID: ' + normalizedId + ' / ' + ss.getName());
  }
}
