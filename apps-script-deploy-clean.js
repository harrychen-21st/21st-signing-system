var SPREADSHEET_ID_PROPERTY_KEY = 'SPREADSHEET_ID';
var SYSTEM_SENDER_EMAIL = 'auto-reply@21stfintech.com';
var SYSTEM_SENDER_NAME = '21CD 內部申請系統';

function getSpreadsheet_() {
  var id = String(PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROPERTY_KEY) || '').trim();
  if (id) return SpreadsheetApp.openById(id);

  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  throw new Error('Spreadsheet not configured. Set script property SPREADSHEET_ID.');
}

function doGet(e) {
  try {
    var action = e.parameter.action;
    var ss = getSpreadsheet_();

    if (action === 'healthcheck') {
      return json_({ success: true, spreadsheetId: ss.getId(), spreadsheetName: ss.getName() });
    }

    if (action === 'getUser') {
      return getUser_(ss, e.parameter.email);
    }

    if (action === 'getData') {
      var sheet = ss.getSheetByName(e.parameter.sheet);
      if (!sheet) return json_({ success: false, error: 'Sheet not found: ' + e.parameter.sheet });
      return json_({ success: true, data: sheet.getDataRange().getValues() });
    }

    if (action === 'getRules') {
      var ruleSheet = ss.getSheetByName('WorkflowRules');
      if (!ruleSheet) return json_({ success: false, error: 'WorkflowRules sheet not found' });
      var rows = ruleSheet.getDataRange().getValues();
      var filtered = [rows[0]];
      for (var i = 1; i < rows.length; i++) {
        if (rows[i][1] === e.parameter.formType) filtered.push(rows[i]);
      }
      return json_({ success: true, data: filtered });
    }

    if (action === 'getAuditLogs') {
      var ticketId = e.parameter.ticketId;
      var logSheet = ss.getSheetByName('AuditLogs');
      if (!logSheet) return json_({ success: true, data: [] });
      var logs = [];
      var logRows = logSheet.getDataRange().getValues();
      for (var j = 1; j < logRows.length; j++) {
        if (logRows[j][0] === ticketId) {
          logs.push({
            ticketId: logRows[j][0],
            action: logRows[j][1],
            approver: logRows[j][2],
            stage: logRows[j][3],
            comment: logRows[j][4],
            timestamp: logRows[j][5]
          });
        }
      }
      return json_({ success: true, data: logs });
    }

    return json_({ success: false, error: 'Unknown GET action: ' + action });
  } catch (error) {
    return json_({ success: false, error: String(error) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var payload = JSON.parse(e.postData.contents || '{}');
    var action = payload.action;
    var ss = getSpreadsheet_();

    if (action === 'submitApplication') {
      return json_(submitApplication_(ss, payload));
    }

    if (action === 'completeTicket') {
      return json_({ success: true, ticket: completeTicket_(ss, payload.ticketId, payload.completedBy, payload.note) });
    }

    if (action === 'saveData') {
      return json_(saveData_(ss, payload));
    }

    if (action === 'addFormType') {
      var formSheet = ensureSheet_(ss, 'FormTypes', ['FormID', 'FormName']);
      formSheet.appendRow([payload.formId, payload.formName]);
      return json_({ success: true });
    }

    if (action === 'saveRules') {
      return json_(saveRules_(ss, payload));
    }

    if (action === 'saveMeetingRoom') {
      return json_(saveMeetingRoom_(ss, payload.room || {}));
    }

    if (action === 'createMeetingBooking') {
      return json_(createMeetingBooking_(ss, payload.booking || {}));
    }

    if (action === 'cancelMeetingBooking') {
      return json_(cancelMeetingBooking_(ss, payload.bookingId, payload.cancelledBy, payload.isAdmin));
    }

    return json_({ success: false, error: 'Unknown POST action: ' + action });
  } catch (error) {
    return json_({ success: false, error: String(error) });
  } finally {
    try {
      lock.releaseLock();
    } catch (ignore) {}
  }
}

function submitApplication_(ss, payload) {
  var now = new Date();
  var formData = payload.formData || {};
  var applicationNumber = generateApplicationNumber_(ss, payload.formType, payload.department, now);
  var amlStatus = syncAmlInvestigation_(ss, {
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
    status = amlStatus.needsInvestigation ? 'Checking' : 'Submitted';
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

  ensureSheet_(ss, 'AuditLogs', ['TicketID', 'ActionType', 'ApproverID', 'Stage', 'Comment', 'Timestamp'])
    .appendRow([applicationNumber, 'Submitted', payload.applicantEmail || '', '0', '送出申請', now.toISOString()]);

  sendApplicantSubmittedEmail_({
    to: payload.applicantEmail,
    applicantName: payload.applicantName,
    applicationNumber: applicationNumber,
    formType: payload.formType,
    subject: payload.subject,
    createdAt: now
  });

  return { success: true, applicationNumber: applicationNumber, amlStatus: amlStatus };
}

function getUser_(ss, email) {
  if (!email) return json_({ success: false, error: 'Missing email parameter' });
  var sheet = ss.getSheetByName('Users');
  if (!sheet) return json_({ success: false, error: 'Users sheet not found' });
  var rows = sheet.getDataRange().getValues();
  var target = String(email).trim().toLowerCase();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim().toLowerCase() === target) {
      return json_({
        success: true,
        user: {
          email: rows[i][0],
          name: rows[i][1],
          dept: rows[i][2],
          manager: rows[i][3],
          roles: rows[i][4] || ''
        }
      });
    }
  }
  return json_({ success: false, error: 'User not found' });
}

function saveData_(ss, payload) {
  var sheet = ensureSheet_(ss, payload.sheet, []);
  var rows = sheet.getDataRange().getValues();
  var matchColumnIndex = Number(payload.matchColumn || 1) - 1;
  var rowIndex = -1;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][matchColumnIndex] == payload.matchValue) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, payload.row.length).setValues([payload.row]);
  } else {
    sheet.appendRow(payload.row);
  }
  return { success: true };
}

function saveRules_(ss, payload) {
  var sheet = ensureSheet_(ss, 'WorkflowRules', ['RuleID', 'FormType', 'Stage', 'ConditionField', 'ConditionOp', 'ConditionVal', 'ApproverType', 'ApproverValue']);
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (rows[i][1] === payload.formType) sheet.deleteRow(i + 1);
  }
  if (payload.rows && payload.rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, payload.rows.length, payload.rows[0].length).setValues(payload.rows);
  }
  return { success: true };
}

function completeTicket_(ss, ticketId, completedBy, note) {
  var sheet = ss.getSheetByName('Tickets');
  if (!sheet) throw new Error('Tickets sheet not found');
  var rows = sheet.getDataRange().getValues();
  var rowIndex = -1;
  var applicantEmail = '';
  var subject = '';
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '') === String(ticketId || '')) {
      rowIndex = i + 1;
      applicantEmail = rows[i][2];
      subject = rows[i][9];
      break;
    }
  }
  if (rowIndex < 0) throw new Error('Ticket not found: ' + ticketId);
  sheet.getRange(rowIndex, 7).setValue('Completed');
  sheet.getRange(rowIndex, 14).setValue('');

  ensureSheet_(ss, 'AuditLogs', ['TicketID', 'ActionType', 'ApproverID', 'Stage', 'Comment', 'Timestamp'])
    .appendRow([ticketId, 'Completed', completedBy || '', 'END', note || '後台完成結案', new Date().toISOString()]);

  if (applicantEmail) {
  safeSendEmail_({
    to: applicantEmail,
    subject: '申請已完成 - ' + ticketId,
    body: ['您的申請已完成。', '', '表單編號：' + ticketId, '主旨：' + (subject || '-'), '備註：' + (note || '-')].join('\n'),
    name: SYSTEM_SENDER_NAME
    });
  }
  return { id: ticketId, status: 'Completed' };
}

function generateApplicationNumber_(ss, formType, department, now) {
  var sheet = ensureSheet_(ss, 'Tickets', [
    'TicketID', 'CreatedAt', 'ApplicantEmail', 'ApplicantName', 'Department', 'FormType',
    'Status', 'CurrentStage', 'SLA_Deadline', 'Subject', 'Amount', 'NeedsAML',
    'FormData_JSON', 'CurrentApprover'
  ]);
  var dateText = Utilities.formatDate(now, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyyMMdd');
  var prefix = String(formType || 'AP').toUpperCase() + extractDeptCode_(department) + dateText;
  var rows = sheet.getDataRange().getValues();
  var maxSeq = 0;
  for (var i = 1; i < rows.length; i++) {
    var id = String(rows[i][0] || '');
    if (id.indexOf(prefix) === 0) {
      var seq = parseInt(id.substring(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return prefix + String(maxSeq + 1).padStart(3, '0');
}

function syncAmlInvestigation_(ss, record) {
  if (!record.taxId) return { skipped: true, reason: 'No tax ID' };

  var amlSheetId = getSetting_(ss, 'AML_SHEET_ID', '1DBnDX8xyLIGhXB-EWjIIeCgmCsoP7pWD0kbryG4rCq4');
  var amlSheet = SpreadsheetApp.openById(amlSheetId).getSheets()[0];
  if (amlSheet.getLastRow() === 0) {
    amlSheet.appendRow(['填表日期', '表單類型', '表單編號', '公司別', '需求單位', '商家名稱', '統一編號', '負責人姓名', '通知管理處查詢', '通知風控查詢']);
  }

  var previous = findPreviousAmlRecord_(amlSheet, record.taxId);
  var adminStatus = previous && previous.adminStatus === '已調查' ? '已調查' : '已通知待調查';
  var riskStatus = previous && previous.riskStatus === '已調查' ? '已調查' : '已通知待調查';
  var needsInvestigation = adminStatus !== '已調查' || riskStatus !== '已調查';

  var headers = amlSheet.getDataRange().getValues()[0];
  var rowByHeader = {
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
  var row = headers.map(function(header) {
    return rowByHeader[normalizeHeader_(header)] || rowByHeader[String(header).trim()] || '';
  });
  amlSheet.appendRow(row);

  if (needsInvestigation) sendInvestigationEmails_(ss, record, adminStatus, riskStatus);
  return { needsInvestigation: needsInvestigation, adminStatus: adminStatus, riskStatus: riskStatus };
}

function findPreviousAmlRecord_(sheet, taxId) {
  if (!taxId || sheet.getLastRow() < 2) return null;
  var rows = sheet.getDataRange().getValues();
  var indexes = mapHeaderIndexes_(rows[0]);
  var taxIndex = indexes['統一編號'];
  var adminIndex = indexes['通知管理處查詢'];
  var riskIndex = indexes['通知風控查詢'];
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][taxIndex] || '').trim() === String(taxId).trim()) {
      return {
        adminStatus: adminIndex == null ? '' : String(rows[i][adminIndex] || '').trim(),
        riskStatus: riskIndex == null ? '' : String(rows[i][riskIndex] || '').trim()
      };
    }
  }
  return null;
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

  safeSendEmail_({
    to: recipients.join(','),
    subject: 'AML/關係人調查通知 - ' + record.applicationNumber,
    body: body,
    name: SYSTEM_SENDER_NAME
  });
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

  safeSendEmail_({
    to: params.to,
    subject: '申請已送出 - ' + params.applicationNumber,
    body: body,
    name: SYSTEM_SENDER_NAME
  });
}

function saveMeetingRoom_(ss, room) {
  var sheet = ensureSheet_(ss, 'MeetingRooms', ['RoomID', 'RoomName', 'Location', 'Capacity', 'IsActive', 'SortOrder', 'OpenTime', 'CloseTime', 'CreatedAt']);
  var roomId = String(room.id || ('ROOM-' + new Date().getTime())).trim();
  var now = new Date().toISOString();
  var row = [
    roomId,
    String(room.name || '').trim(),
    String(room.location || '').trim(),
    String(room.capacity || '').trim(),
    room.isActive === false ? 'FALSE' : 'TRUE',
    String(room.sortOrder || '').trim(),
    '09:00',
    '18:00',
    room.createdAt || now
  ];
  var rows = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '') === roomId) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  return { success: true, room: { id: roomId } };
}

function createMeetingBooking_(ss, booking) {
  var roomsSheet = ensureSheet_(ss, 'MeetingRooms', ['RoomID', 'RoomName', 'Location', 'Capacity', 'IsActive', 'SortOrder', 'OpenTime', 'CloseTime', 'CreatedAt']);
  var bookingsSheet = ensureSheet_(ss, 'MeetingBookings', ['BookingID', 'RoomID', 'RoomName', 'BookerEmail', 'BookerName', 'Department', 'Date', 'StartTime', 'EndTime', 'Purpose', 'Status', 'CreatedAt', 'UpdatedAt', 'CancelledAt', 'CancelledBy', 'ReminderSentAt']);
  var room = findMeetingRoom_(roomsSheet, booking.roomId);
  if (!room) throw new Error('找不到會議室');
  if (room.isActive !== 'TRUE') throw new Error('此會議室未上架');

  var date = String(booking.date || '').trim();
  var startTime = String(booking.startTime || '').trim();
  var endTime = String(booking.endTime || '').trim();
  var purpose = String(booking.purpose || '').trim();
  if (!date || !startTime || !endTime || !purpose) throw new Error('會議室、日期、時間與用途皆為必填');

  validateMeetingTime_(date, startTime, endTime);
  if (hasMeetingConflict_(bookingsSheet, room.id, date, startTime, endTime, '')) {
    throw new Error('此時段已被預約，請選擇其他時間');
  }

  var now = new Date();
  var bookingId = 'MR' + Utilities.formatDate(now, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
  var row = [
    bookingId,
    room.id,
    room.name,
    String(booking.bookerEmail || '').trim(),
    String(booking.bookerName || '').trim(),
    String(booking.department || '').trim(),
    date,
    startTime,
    endTime,
    purpose,
    'Booked',
    now.toISOString(),
    now.toISOString(),
    '',
    '',
    ''
  ];
  bookingsSheet.appendRow(row);
  sendMeetingBookedEmail_(row);
  return { success: true, booking: meetingBookingFromRow_(row) };
}

function cancelMeetingBooking_(ss, bookingId, cancelledBy, isAdmin) {
  var sheet = ensureSheet_(ss, 'MeetingBookings', ['BookingID', 'RoomID', 'RoomName', 'BookerEmail', 'BookerName', 'Department', 'Date', 'StartTime', 'EndTime', 'Purpose', 'Status', 'CreatedAt', 'UpdatedAt', 'CancelledAt', 'CancelledBy', 'ReminderSentAt']);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '') === String(bookingId || '')) {
      var owner = String(rows[i][3] || '').trim().toLowerCase();
      var actor = String(cancelledBy || '').trim().toLowerCase();
      if (!isAdmin && owner !== actor) throw new Error('只能取消自己的預約');
      var now = new Date().toISOString();
      sheet.getRange(i + 1, 11).setValue('Cancelled');
      sheet.getRange(i + 1, 13).setValue(now);
      sheet.getRange(i + 1, 14).setValue(now);
      sheet.getRange(i + 1, 15).setValue(cancelledBy || '');
      sendMeetingCancelledEmail_(rows[i], cancelledBy);
      return { success: true };
    }
  }
  throw new Error('找不到預約紀錄');
}

function findMeetingRoom_(sheet, roomId) {
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '') === String(roomId || '')) {
      return {
        id: rows[i][0],
        name: rows[i][1],
        location: rows[i][2],
        capacity: rows[i][3],
        isActive: String(rows[i][4] || '').toUpperCase() === 'FALSE' ? 'FALSE' : 'TRUE',
        openTime: rows[i][6] || '09:00',
        closeTime: rows[i][7] || '18:00'
      };
    }
  }
  return null;
}

function validateMeetingTime_(date, startTime, endTime) {
  date = normalizeMeetingDate_(date);
  startTime = normalizeMeetingTime_(startTime);
  endTime = normalizeMeetingTime_(endTime);
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM-dd');
  var maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 30);
  var maxDateText = Utilities.formatDate(maxDate, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM-dd');
  if (date < today) throw new Error('不能預約過去日期');
  if (date > maxDateText) throw new Error('只能預約未來 30 天內的會議室');

  var start = timeToMinutes_(startTime);
  var end = timeToMinutes_(endTime);
  if (start < 9 * 60 || end > 18 * 60) throw new Error('會議室開放時間為 09:00-18:00');
  if (start >= end) throw new Error('結束時間必須晚於開始時間');
  if (start % 30 !== 0 || end % 30 !== 0) throw new Error('預約時間需以 30 分鐘為單位');
  if (end - start < 30) throw new Error('最短預約 30 分鐘');
  if (end - start > 120) throw new Error('一次最多預約 2 小時');
}

function hasMeetingConflict_(sheet, roomId, date, startTime, endTime, ignoreBookingId) {
  var rows = sheet.getDataRange().getValues();
  var targetDate = normalizeMeetingDate_(date);
  var start = timeToMinutes_(normalizeMeetingTime_(startTime));
  var end = timeToMinutes_(normalizeMeetingTime_(endTime));
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '') === String(ignoreBookingId || '')) continue;
    if (String(rows[i][1] || '') !== String(roomId || '')) continue;
    if (normalizeMeetingDate_(rows[i][6]) !== targetDate) continue;
    if (String(rows[i][10] || '') === 'Cancelled') continue;
    var existingStart = timeToMinutes_(normalizeMeetingTime_(rows[i][7]));
    var existingEnd = timeToMinutes_(normalizeMeetingTime_(rows[i][8]));
    if (start < existingEnd && end > existingStart) return true;
  }
  return false;
}

function normalizeMeetingDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM-dd');
  }
  var text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  var date = new Date(text);
  if (!isNaN(date.getTime())) {
    return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM-dd');
  }
  return text;
}

function normalizeMeetingTime_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Taipei', 'HH:mm');
  }
  var text = String(value).trim();
  if (/^\d{1,2}:\d{2}/.test(text)) {
    var parts = text.split(':');
    return String(Number(parts[0])).padStart(2, '0') + ':' + parts[1].slice(0, 2);
  }
  var date = new Date(text);
  if (!isNaN(date.getTime())) {
    return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Taipei', 'HH:mm');
  }
  return text;
}

function timeToMinutes_(timeText) {
  var parts = normalizeMeetingTime_(timeText).split(':');
  return Number(parts[0] || 0) * 60 + Number(parts[1] || 0);
}

function meetingBookingFromRow_(row) {
  return {
    id: row[0],
    roomId: row[1],
    roomName: row[2],
    bookerEmail: row[3],
    bookerName: row[4],
    department: row[5],
    date: normalizeMeetingDate_(row[6]),
    startTime: normalizeMeetingTime_(row[7]),
    endTime: normalizeMeetingTime_(row[8]),
    purpose: row[9],
    status: row[10],
    createdAt: row[11],
    updatedAt: row[12],
    cancelledAt: row[13],
    cancelledBy: row[14],
    reminderSentAt: row[15]
  };
}

function googleCalendarUrl_(row) {
  var bookingDate = normalizeMeetingDate_(row[6]);
  var startTime = normalizeMeetingTime_(row[7]);
  var endTime = normalizeMeetingTime_(row[8]);
  var start = bookingDate.replace(/-/g, '') + 'T' + startTime.replace(':', '') + '00';
  var end = bookingDate.replace(/-/g, '') + 'T' + endTime.replace(':', '') + '00';
  var title = encodeURIComponent(row[2] + ' 預約');
  var details = encodeURIComponent('用途：' + row[9] + '\n預約單號：' + row[0]);
  var location = encodeURIComponent(row[2]);
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + title + '&dates=' + start + '/' + end + '&details=' + details + '&location=' + location + '&ctz=Asia/Taipei';
}

function sendMeetingBookedEmail_(row) {
  if (!row[3]) return;
  var bookingDate = normalizeMeetingDate_(row[6]);
  var startTime = normalizeMeetingTime_(row[7]);
  var endTime = normalizeMeetingTime_(row[8]);
  safeSendEmail_({
    to: row[3],
    subject: '會議室預約成功 - ' + row[2] + ' ' + bookingDate + ' ' + startTime,
    body: [
      (row[4] || '您好') + '，您的會議室預約已建立。',
      '',
      '預約單號：' + row[0],
      '會議室：' + row[2],
      '日期：' + bookingDate,
      '時間：' + startTime + '-' + endTime,
      '用途：' + row[9],
      '',
      '加入 Google Calendar：',
      googleCalendarUrl_(row)
    ].join('\n'),
    name: SYSTEM_SENDER_NAME
  });
}

function sendMeetingCancelledEmail_(row, cancelledBy) {
  if (!row[3]) return;
  var bookingDate = normalizeMeetingDate_(row[6]);
  var startTime = normalizeMeetingTime_(row[7]);
  var endTime = normalizeMeetingTime_(row[8]);
  safeSendEmail_({
    to: row[3],
    subject: '會議室預約已取消 - ' + row[2] + ' ' + bookingDate + ' ' + startTime,
    body: ['您的會議室預約已取消。', '', '預約單號：' + row[0], '會議室：' + row[2], '日期：' + bookingDate, '時間：' + startTime + '-' + endTime, '取消人：' + (cancelledBy || '-')].join('\n'),
    name: SYSTEM_SENDER_NAME
  });
}

function sendMeetingReminders() {
  var ss = getSpreadsheet_();
  var sheet = ensureSheet_(ss, 'MeetingBookings', ['BookingID', 'RoomID', 'RoomName', 'BookerEmail', 'BookerName', 'Department', 'Date', 'StartTime', 'EndTime', 'Purpose', 'Status', 'CreatedAt', 'UpdatedAt', 'CancelledAt', 'CancelledBy', 'ReminderSentAt']);
  var rows = sheet.getDataRange().getValues();
  var now = new Date();
  var tz = Session.getScriptTimeZone() || 'Asia/Taipei';
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][10] || '') !== 'Booked') continue;
    if (rows[i][15]) continue;
    var bookingDate = normalizeMeetingDate_(rows[i][6]);
    var startTime = normalizeMeetingTime_(rows[i][7]);
    var endTime = normalizeMeetingTime_(rows[i][8]);
    var start = new Date(bookingDate + 'T' + startTime + ':00+08:00');
    var minutes = (start.getTime() - now.getTime()) / 60000;
    if (minutes >= 0 && minutes <= 10) {
      safeSendEmail_({
        to: rows[i][3],
        subject: '會議室即將開始 - ' + rows[i][2] + ' ' + startTime,
        body: ['您的會議室預約即將開始。', '', '會議室：' + rows[i][2], '日期：' + bookingDate, '時間：' + startTime + '-' + endTime, '用途：' + rows[i][9]].join('\n'),
        name: SYSTEM_SENDER_NAME
      });
      sheet.getRange(i + 1, 16).setValue(Utilities.formatDate(now, tz, 'yyyy/MM/dd HH:mm:ss'));
    }
  }
}

function setupRealData() {
  var ss = getSpreadsheet_();
  ensureSheet_(ss, 'Users', ['Email', 'Name', 'Department', 'ManagerEmail', 'Roles']);
  ensureSheet_(ss, 'Tickets', ['TicketID', 'CreatedAt', 'ApplicantEmail', 'ApplicantName', 'Department', 'FormType', 'Status', 'CurrentStage', 'SLA_Deadline', 'Subject', 'Amount', 'NeedsAML', 'FormData_JSON', 'CurrentApprover']);
  var formTypesSheet = ensureSheet_(ss, 'FormTypes', ['FormID', 'FormName']);
  ensureDefaultFormTypes_(formTypesSheet);
  ensureSheet_(ss, 'WorkflowRules', ['RuleID', 'FormType', 'Stage', 'ConditionField', 'ConditionOp', 'ConditionVal', 'ApproverType', 'ApproverValue']);
  ensureSheet_(ss, 'AuditLogs', ['TicketID', 'ActionType', 'ApproverID', 'Stage', 'Comment', 'Timestamp']);
  ensureSheet_(ss, 'FormDefinitions', ['FormID', 'FieldsMarkdown', 'LogicMarkdown', 'ConfigJSON']);
  ensureSheet_(ss, 'MeetingRooms', ['RoomID', 'RoomName', 'Location', 'Capacity', 'IsActive', 'SortOrder', 'OpenTime', 'CloseTime', 'CreatedAt']);
  ensureSheet_(ss, 'MeetingBookings', ['BookingID', 'RoomID', 'RoomName', 'BookerEmail', 'BookerName', 'Department', 'Date', 'StartTime', 'EndTime', 'Purpose', 'Status', 'CreatedAt', 'UpdatedAt', 'CancelledAt', 'CancelledBy', 'ReminderSentAt']);
  var settingsSheet = ensureSheet_(ss, 'SystemSettings', ['Key', 'Value']);
  setDefaultSetting_(settingsSheet, 'DEFAULT_COMPANY_CODE', '21CD');
  setDefaultSetting_(settingsSheet, 'AML_SHEET_ID', '1DBnDX8xyLIGhXB-EWjIIeCgmCsoP7pWD0kbryG4rCq4');
  setDefaultSetting_(settingsSheet, 'ADMIN_CHECK_EMAILS', '');
  setDefaultSetting_(settingsSheet, 'RISK_CHECK_EMAILS', '');
  setDefaultSetting_(settingsSheet, 'NoticeBoard', '歡迎使用企業內部申請系統。');
}

function ensureDefaultFormTypes_(sheet) {
  var rows = sheet.getDataRange().getValues();
  var existing = {};
  for (var i = 1; i < rows.length; i++) {
    existing[String(rows[i][0] || '').trim()] = true;
  }
  var defaults = [
    ['AP', '簽呈單 (AP)'],
    ['RD', '請款單 (RD)'],
    ['CS', '用印申請單 (CS)']
  ];
  defaults.forEach(function(row) {
    if (!existing[row[0]]) sheet.appendRow(row);
  });
}

function authorizeMail() {
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error('找不到目前登入者 Email，請確認使用 Google Workspace 帳號執行。');
  GmailApp.sendEmail(email, '21CD 內部申請系統寄信授權測試', '如果您收到這封信，代表 Apps Script 寄信權限已授權完成。', {
    from: SYSTEM_SENDER_EMAIL,
    name: SYSTEM_SENDER_NAME
  });
}

function getSenderStatus() {
  var aliases = GmailApp.getAliases();
  return {
    senderEmail: SYSTEM_SENDER_EMAIL,
    senderName: SYSTEM_SENDER_NAME,
    aliases: aliases,
    senderConfigured: aliases.indexOf(SYSTEM_SENDER_EMAIL) >= 0
  };
}

function safeSendEmail_(message) {
  try {
    GmailApp.sendEmail(String(message.to || ''), String(message.subject || ''), String(message.body || ''), {
      from: SYSTEM_SENDER_EMAIL,
      name: message.name || SYSTEM_SENDER_NAME
    });
    return true;
  } catch (error) {
    Logger.log('Mail send skipped: ' + error);
    return false;
  }
}

function ensureSheet_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9ead3');
    }
  } else if (sheet.getLastRow() === 0 && headers && headers.length) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function getSetting_(ss, key, fallback) {
  var sheet = ss.getSheetByName('SystemSettings');
  if (!sheet) return fallback;
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === key) {
      return String(rows[i][1] || '').trim() || fallback;
    }
  }
  return fallback;
}

function setDefaultSetting_(sheet, key, value) {
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === key) return;
  }
  sheet.appendRow([key, value]);
}

function extractDeptCode_(department) {
  var match = String(department || '').trim().match(/^[A-Za-z0-9]+/);
  return (match ? match[0] : 'XX').toUpperCase();
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

function parseEmailList_(value) {
  return String(value || '').split(',').map(function(email) {
    return email.trim();
  }).filter(Boolean);
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function setSpreadsheetId(spreadsheetId) {
  var id = String(spreadsheetId || '').trim();
  if (!id) throw new Error('Missing spreadsheetId');
  PropertiesService.getScriptProperties().setProperty(SPREADSHEET_ID_PROPERTY_KEY, id);
}
