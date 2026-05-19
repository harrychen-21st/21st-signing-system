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

function doGet(e) {
  try {
    var action = e.parameter.action;
    var ss = getSpreadsheet_();

    if (action === 'healthcheck') {
      return createJsonResponse({ success: true, spreadsheet: getSpreadsheetInfo_() });
    }

    if (action === 'getUser') {
      var email = e.parameter.email;
      if (!email) return createJsonResponse({ success: false, error: 'Missing email parameter' });
      var userSheet = ss.getSheetByName('Users');
      if (!userSheet) return createJsonResponse({ success: false, error: 'Users sheet not found' });
      var data = userSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().toLowerCase() === email.toLowerCase()) {
          return createJsonResponse({
            success: true,
            user: { email: data[i][0], name: data[i][1], dept: data[i][2], manager: data[i][3], roles: data[i][4] || '' }
          });
        }
      }
      return createJsonResponse({ success: false, error: 'User not found' });
    }

    if (action === 'getData') {
      var sheetName = e.parameter.sheet;
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) return createJsonResponse({ success: false, error: 'Sheet not found: ' + sheetName });
      return createJsonResponse({ success: true, data: sheet.getDataRange().getValues() });
    }

    if (action === 'getRules') {
      var formType = e.parameter.formType;
      var ruleSheet = ss.getSheetByName('WorkflowRules');
      if (!ruleSheet) return createJsonResponse({ success: false, error: 'WorkflowRules sheet not found' });
      var ruleData = ruleSheet.getDataRange().getValues();
      var filteredData = [ruleData[0]];
      for (var r = 1; r < ruleData.length; r++) {
        if (ruleData[r][1] === formType) filteredData.push(ruleData[r]);
      }
      return createJsonResponse({ success: true, data: filteredData });
    }

    if (action === 'getFormTypes') {
      var formSheet = ss.getSheetByName('FormTypes');
      if (!formSheet) {
        return createJsonResponse({ success: true, data: [['FormID', 'FormName'], ['AP', '簽呈單 (AP)'], ['RD', '請款單 (RD)'], ['CS', '用印申請單 (CS)']] });
      }
      return createJsonResponse({ success: true, data: formSheet.getDataRange().getValues() });
    }

    if (action === 'getSetting') {
      var key = e.parameter.key;
      var settingsSheet = ss.getSheetByName('SystemSettings');
      if (!settingsSheet) return createJsonResponse({ success: true, key: key, value: '' });
      var settingsData = settingsSheet.getDataRange().getValues();
      for (var s = 1; s < settingsData.length; s++) {
        if (String(settingsData[s][0]) === String(key)) {
          return createJsonResponse({ success: true, key: key, value: settingsData[s][1] || '' });
        }
      }
      return createJsonResponse({ success: true, key: key, value: '' });
    }

    if (action === 'getPendingTickets') {
      var approverEmail = String(e.parameter.email || '').toLowerCase();
      var pendingUsersSheet = ss.getSheetByName('Users');
      var pendingTicketsSheet = ss.getSheetByName('Tickets');
      if (!pendingUsersSheet || !pendingTicketsSheet) return createJsonResponse({ success: true, tickets: [] });

      var pendingUsers = pendingUsersSheet.getDataRange().getValues();
      var pendingUserRow = null;
      for (var pu = 1; pu < pendingUsers.length; pu++) {
        if (String(pendingUsers[pu][0] || '').toLowerCase() === approverEmail) {
          pendingUserRow = pendingUsers[pu];
          break;
        }
      }
      var pendingRoles = pendingUserRow && pendingUserRow[4] ? String(pendingUserRow[4]).split(',').map(function(role) { return String(role).trim(); }).filter(Boolean) : [];

      var pendingRows = pendingTicketsSheet.getDataRange().getValues();
      var pendingTickets = [];
      for (var pt = 1; pt < pendingRows.length; pt++) {
        var ticketRow = pendingRows[pt];
        if (ticketRow[6] !== 'Pending') continue;
        if (isTicketForApprover_(ticketRow, pendingRoles, approverEmail)) {
          pendingTickets.push({
            id: ticketRow[0],
            createdAt: ticketRow[1],
            applicantEmail: ticketRow[2],
            applicantName: ticketRow[3],
            dept: ticketRow[4],
            formType: ticketRow[5],
            status: ticketRow[6],
            stage: ticketRow[7],
            subject: ticketRow[9],
            amount: ticketRow[10],
            currentApprover: ticketRow[13],
            complianceRequired: ticketRow[11] === 'TRUE',
            compliance: {
              aml_result: ticketRow[14] || '',
              aml_comment: ticketRow[15] || '',
              rp_result: ticketRow[16] || '',
              rp_comment: ticketRow[17] || ''
            }
          });
        }
      }
      return createJsonResponse({ success: true, tickets: pendingTickets });
    }

    if (action === 'getMyTickets') {
      var applicantEmail = String(e.parameter.email || '').toLowerCase();
      var myTicketsSheet = ss.getSheetByName('Tickets');
      var myUsersSheet = ss.getSheetByName('Users');
      if (!myTicketsSheet || !myUsersSheet) return createJsonResponse({ success: true, tickets: [] });

      var myTicketRows = myTicketsSheet.getDataRange().getValues();
      var myUsers = myUsersSheet.getDataRange().getValues();
      var myTickets = [];
      for (var mt = 1; mt < myTicketRows.length; mt++) {
        var myRow = myTicketRows[mt];
        if (String(myRow[2] || '').toLowerCase() !== applicantEmail) continue;
        myTickets.push({
          id: myRow[0],
          createdAt: myRow[1],
          applicantEmail: myRow[2],
          applicantName: myRow[3],
          dept: myRow[4],
          formType: myRow[5],
          status: myRow[6],
          stage: myRow[7],
          subject: myRow[9],
          amount: myRow[10],
          formData: myRow[12] ? JSON.parse(myRow[12]) : {},
          currentApprover: formatApproverDisplay_(String(myRow[13] || ''), myUsers)
        });
      }
      return createJsonResponse({ success: true, tickets: myTickets });
    }

    if (action === 'getAuditLogs') {
      var ticketId = e.parameter.ticketId;
      var logSheet = ss.getSheetByName('AuditLogs');
      if (!logSheet) return createJsonResponse({ success: false, error: 'AuditLogs sheet not found' });
      var logData = logSheet.getDataRange().getValues();
      var logs = [];
      for (var l = 1; l < logData.length; l++) {
        if (logData[l][0] === ticketId) {
          logs.push({
            ticketId: logData[l][0],
            action: logData[l][1],
            approver: logData[l][2],
            stage: logData[l][3],
            comment: logData[l][4],
            timestamp: logData[l][5]
          });
        }
      }
      return createJsonResponse({ success: true, data: logs });
    }

    return createJsonResponse({ success: false, error: 'Unknown GET action: ' + action });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ success: false, error: 'Empty POST data' });
    }

    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    var ss = getSpreadsheet_();

    if (action === 'submitTickets') {
      var ticketSheet = ss.getSheetByName('Tickets');
      var auditSheet = ss.getSheetByName('AuditLogs');
      if (!ticketSheet) return createJsonResponse({ success: false, error: 'Tickets sheet not found' });
      var rows = payload.rows;
      var generatedIds = [];
      if (rows && rows.length > 0) {
        for (var tr = 0; tr < rows.length; tr++) {
          rows[tr][0] = generateTicketNumber_(ticketSheet, rows[tr][5], rows[tr][4], rows[tr][0]);
          generatedIds.push(rows[tr][0]);
        }
        ticketSheet.getRange(ticketSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

        if (auditSheet) {
          var submitLogs = rows.map(function(row) { return [row[0], 'Submitted', row[2], '0', '發起申請', row[1]]; });
          auditSheet.getRange(auditSheet.getLastRow() + 1, 1, submitLogs.length, submitLogs[0].length).setValues(submitLogs);
        }
      }
      return createJsonResponse({ success: true, generatedIds: generatedIds });
    }

    if (action === 'saveRules') {
      var formType = payload.formType;
      var newRows = payload.rows;
      var workflowSheet = ss.getSheetByName('WorkflowRules');
      if (!workflowSheet) return createJsonResponse({ success: false, error: 'WorkflowRules sheet not found' });
      var workflowData = workflowSheet.getDataRange().getValues();
      for (var wr = workflowData.length - 1; wr >= 1; wr--) {
        if (workflowData[wr][1] === formType) workflowSheet.deleteRow(wr + 1);
      }
      if (newRows && newRows.length > 0) {
        var startRow = Math.max(2, workflowSheet.getLastRow() + 1);
        workflowSheet.getRange(startRow, 1, newRows.length, newRows[0].length).setValues(newRows);
      }
      return createJsonResponse({ success: true });
    }

    if (action === 'addFormType') {
      var formId = payload.formId;
      var formName = payload.formName;
      var formTypesSheet = ss.getSheetByName('FormTypes');
      if (!formTypesSheet) return createJsonResponse({ success: false, error: 'FormTypes sheet not found' });
      formTypesSheet.appendRow([formId, formName]);
      return createJsonResponse({ success: true });
    }

    if (action === 'saveData') {
      var sheetName = payload.sheet;
      var matchCol = payload.matchColumn;
      var matchVal = payload.matchValue;
      var newRow = payload.row;
      var targetSheet = ss.getSheetByName(sheetName);
      if (!targetSheet) return createJsonResponse({ success: false, error: sheetName + ' sheet not found' });

      var targetData = targetSheet.getDataRange().getValues();
      var rowIndex = -1;
      for (var td = 1; td < targetData.length; td++) {
        if (targetData[td][matchCol - 1] == matchVal) {
          rowIndex = td + 1;
          break;
        }
      }

      if (rowIndex !== -1) {
        targetSheet.getRange(rowIndex, 1, 1, newRow.length).setValues([newRow]);
      } else {
        targetSheet.appendRow(newRow);
      }
      return createJsonResponse({ success: true });
    }

    if (action === 'saveSetting') {
      var settingsKey = payload.key;
      var settingsValue = payload.value;
      var settingsSheet = ss.getSheetByName('SystemSettings');
      if (!settingsSheet) return createJsonResponse({ success: false, error: 'SystemSettings sheet not found' });

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

    if (action === 'login') {
      var loginEmail = String(payload.email || '').toLowerCase();
      if (!loginEmail) return createJsonResponse({ success: false, error: 'Missing email' });

      var loginUserSheet = ss.getSheetByName('Users');
      if (!loginUserSheet) return createJsonResponse({ success: false, error: 'Users sheet not found' });

      var loginRows = loginUserSheet.getDataRange().getValues();
      for (var lu = 1; lu < loginRows.length; lu++) {
        if (String(loginRows[lu][0] || '').toLowerCase() === loginEmail) {
          return createJsonResponse({
            success: true,
            user: {
              email: loginRows[lu][0],
              name: loginRows[lu][1],
              dept: loginRows[lu][2],
              manager: loginRows[lu][3],
              roles: String(loginRows[lu][4] || '').split(',').map(function(role) { return String(role).trim(); }).filter(Boolean)
            },
            expiresInDays: 7
          });
        }
      }

      return createJsonResponse({ success: false, error: 'User not found' });
    }

    if (action === 'updateTicketActionProxy') {
      return createJsonResponse({ success: false, error: 'GitHub Pages 直連模式下，簽核 action 仍需透過 Node server 的 /api/tickets/:ticketId/action 執行規則判斷。' });
    }

    if (action === 'updateTicket') {
      var ticketId = payload.ticketId;
      var newStatus = payload.status;
      var newStage = payload.stage;
      var nextApprover = payload.nextApprover;
      var comment = payload.comment;
      var actionType = payload.actionType;
      var approverEmail = payload.approverEmail;
      var compliance = payload.compliance || null;

      var sheet = ss.getSheetByName('Tickets');
      var logSheet = ss.getSheetByName('AuditLogs');
      if (!sheet) return createJsonResponse({ success: false, error: 'Tickets sheet not found' });

      var data = sheet.getDataRange().getValues();
      var ticketRowIndex = -1;
      var currentStageLabel = '';

      for (var ti = 1; ti < data.length; ti++) {
        if (data[ti][0] === ticketId) {
          ticketRowIndex = ti + 1;
          currentStageLabel = data[ti][7];
          break;
        }
      }

      if (ticketRowIndex === -1) return createJsonResponse({ success: false, error: 'Ticket ID not found: ' + ticketId });

      sheet.getRange(ticketRowIndex, 7).setValue(newStatus);
      sheet.getRange(ticketRowIndex, 8).setValue(newStage);
      sheet.getRange(ticketRowIndex, 14).setValue(nextApprover);
      if (compliance) {
        sheet.getRange(ticketRowIndex, 15).setValue(compliance.aml_result || '');
        sheet.getRange(ticketRowIndex, 16).setValue(compliance.aml_comment || '');
        sheet.getRange(ticketRowIndex, 17).setValue(compliance.rp_result || '');
        sheet.getRange(ticketRowIndex, 18).setValue(compliance.rp_comment || '');
      }

      if (logSheet) {
        var logAction = actionType === 'approve' ? 'Approved' : 'Rejected';
        logSheet.appendRow([ticketId, logAction, approverEmail, currentStageLabel, comment || '', new Date().toISOString()]);
      }

      return createJsonResponse({ success: true });
    }

    return createJsonResponse({ success: false, error: 'Unknown POST action: ' + action });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function setupRealData() {
  var ss = getSpreadsheet_();
  var ticketHeaders = ['TicketID', 'CreatedAt', 'ApplicantEmail', 'ApplicantName', 'Department', 'FormType', 'Status', 'CurrentStage', 'SLA_Deadline', 'Subject', 'Amount', 'NeedsAML', 'FormData_JSON', 'CurrentApprover', 'AML_Result', 'AML_Comment', 'RP_Result', 'RP_Comment'];

  var _checkAndCreate = function(name, headers) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9ead3');
    } else {
      ensureSheetHeaders_(sheet, headers);
    }
    return sheet;
  };

  _checkAndCreate('Users', ['Email', 'Name', 'Department', 'ManagerEmail', 'Roles']);
  _checkAndCreate('Tickets', ticketHeaders);
  var formsSheet = _checkAndCreate('FormTypes', ['FormID', 'FormName']);
  var rulesSheet = _checkAndCreate('WorkflowRules', ['RuleID', 'FormType', 'Stage', 'ConditionField', 'ConditionOp', 'ConditionVal', 'ApproverType', 'ApproverValue']);
  _checkAndCreate('AuditLogs', ['TicketID', 'ActionType', 'ApproverID', 'Stage', 'Comment', 'Timestamp']);
  _checkAndCreate('FormDefinitions', ['FormID', 'FieldsMarkdown', 'LogicMarkdown', 'ConfigJSON']);
  _checkAndCreate('SystemSettings', ['Key', 'Value']);
  var usersSheet = ss.getSheetByName('Users');
  var settingsSheet = ss.getSheetByName('SystemSettings');

  formsSheet.getRange(2, 1, formsSheet.getLastRow() || 2, 2).clearContent();
  formsSheet.getRange(2, 1, 3, 2).setValues([
    ['AP', '簽呈單 (AP)'],
    ['RD', '請款單 (RD)'],
    ['CS', '用印申請單 (CS)']
  ]);

  var ruleData = [
    ['AP_1', 'AP', 1, 'ALWAYS', 'TRUE', '', 'MANAGER', ''],
    ['AP_2', 'AP', 2, 'ALWAYS', 'TRUE', '', 'ROLE', 'ROLE:DEPT_HEAD'],
    ['AP_3', 'AP', 3, 'external_collab', '==', 'true', 'SPECIAL:AML_CHECK', 'ROLE:ADMIN_HEAD'],
    ['AP_4', 'AP', 4, 'ALWAYS', 'TRUE', '', 'ROLE', 'ROLE:ADMIN_GM'],
    ['AP_5', 'AP', 5, 'ALWAYS', 'TRUE', '', 'ROLE', 'ROLE:GM'],
    ['RD_1', 'RD', 1, 'ALWAYS', 'TRUE', '', 'MANAGER', ''],
    ['RD_2', 'RD', 2, 'ALWAYS', 'TRUE', '', 'ROLE', 'ROLE:DEPT_HEAD'],
    ['RD_3', 'RD', 3, 'amount', '>', '5000', 'ROLE', 'ROLE:ADMIN_GM'],
    ['RD_4', 'RD', 4, 'amount', '>', '5000', 'ROLE', 'ROLE:GM'],
    ['CS_1', 'CS', 1, 'ALWAYS', 'TRUE', '', 'MANAGER', ''],
    ['CS_2', 'CS', 2, 'ALWAYS', 'TRUE', '', 'ROLE', 'ROLE:DEPT_HEAD'],
    ['CS_3', 'CS', 3, 'seal_type', 'IN', '經濟部章,銀行用章,法務章,合約便章', 'ROLE', 'ROLE:ADMIN_GM'],
    ['CS_4', 'CS', 4, 'seal_type', 'IN', '經濟部章,銀行用章,法務章,合約便章', 'ROLE', 'ROLE:GM'],
    ['CS_5', 'CS', 5, 'seal_type', 'IN', '經濟部章,銀行用章,法務章,合約便章', 'ROLE', 'ROLE:BIG_SEAL_MGR'],
    ['CS_6', 'CS', 6, 'seal_type', 'IN', '經濟部章,銀行用章,法務章,合約便章', 'ROLE', 'ROLE:SMALL_SEAL_MGR']
  ];

  rulesSheet.getRange(2, 1, rulesSheet.getLastRow() || 2, 8).clearContent();
  rulesSheet.getRange(2, 1, ruleData.length, 8).setValues(ruleData);

  upsertUsers_(usersSheet, [
    ['test@company.com', '陳小明 (員工測試)', 'MK 行銷企劃部', 'boss@company.com', 'ROLE:EMPLOYEE'],
    ['boss@company.com', '李大方 (主管測試)', 'GM 總經理室', 'boss@company.com', 'ROLE:DEPT_HEAD,ROLE:GM'],
    ['admin@company.com', '王維運 (管理員)', 'IT 資訊處', 'boss@company.com', 'ROLE:ADMIN'],
    ['aml@company.com', '周合規 (AML審查)', 'AD 管理處', 'boss@company.com', 'ROLE:ADMIN_HEAD'],
    ['finance@company.com', '林會計 (財務)', 'FN 財務處', 'boss@company.com', 'ROLE:FINANCE,ROLE:ADMIN_GM']
  ]);

  if (settingsSheet.getLastRow() <= 1) {
    settingsSheet.getRange(2, 1, 2, 2).setValues([
      ['NoticeBoard', JSON.stringify([{ id: 'notice-1', title: '申請流程公告', content: '請點擊文字了解申請流程', publishedAt: new Date().toISOString() }])],
      ['NoticeBoardLegacy', '請點擊文字了解申請流程']
    ]);
  }

  try {
    SpreadsheetApp.getUi().alert('成功匯入貴公司真實的【表單定義】與【簽核路徑規則表】，並建立了 AuditLogs 工作表！');
  } catch (e) {
    Logger.log('成功匯入貴公司真實的【表單定義】與【簽核路徑規則表】，並建立了 AuditLogs 工作表！');
  }
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

function ensureSheetHeaders_(sheet, expectedHeaders) {
  var existingLastColumn = Math.max(sheet.getLastColumn(), 1);
  var existingHeaders = sheet.getRange(1, 1, 1, existingLastColumn).getValues()[0];
  var normalizedExisting = existingHeaders.map(function(h) { return String(h || '').trim(); });

  for (var i = 0; i < expectedHeaders.length; i++) {
    var expected = expectedHeaders[i];
    if (normalizedExisting[i] === expected) continue;

    var foundIndex = normalizedExisting.indexOf(expected);
    if (foundIndex !== -1) {
      continue;
    }

    sheet.getRange(1, i + 1).setValue(expected);
    normalizedExisting[i] = expected;
  }

  sheet.getRange(1, 1, 1, expectedHeaders.length).setFontWeight('bold').setBackground('#d9ead3');

  if (normalizedExisting[12] === 'FormData') {
    sheet.getRange(1, 13).setValue('FormData_JSON');
  }
}

function formatApproverDisplay_(approverStr, users) {
  if (!approverStr) return '';
  if (approverStr.indexOf('ROLE:') === 0) return approverStr;
  for (var i = 1; i < users.length; i++) {
    if (String(users[i][0] || '').toLowerCase() === approverStr.toLowerCase()) {
      return String(users[i][1] || approverStr);
    }
  }
  return approverStr;
}

function isTicketForApprover_(row, myRoles, email) {
  var approver = String(row[13] || '');
  var formData = row[12] ? JSON.parse(row[12]) : {};
  var specialRole = formData.__specialApproverRole || 'ROLE:ADMIN_HEAD';
  if (!approver) return false;
  if (approver.toLowerCase() === email) return true;
  if (myRoles.indexOf(approver) !== -1) return true;
  if (approver === 'SPECIAL:AML_CHECK') return myRoles.indexOf(String(specialRole)) !== -1;
  return false;
}

function upsertUsers_(sheet, users) {
  var data = sheet.getDataRange().getValues();
  var emailToRow = {};

  for (var i = 1; i < data.length; i++) {
    var existingEmail = String(data[i][0] || '').toLowerCase();
    if (existingEmail) {
      emailToRow[existingEmail] = i + 1;
    }
  }

  for (var u = 0; u < users.length; u++) {
    var user = users[u];
    var email = String(user[0] || '').toLowerCase();
    if (!email) continue;

    if (emailToRow[email]) {
      sheet.getRange(emailToRow[email], 1, 1, user.length).setValues([user]);
    } else {
      sheet.appendRow(user);
      emailToRow[email] = sheet.getLastRow();
    }
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
