import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config({ path: '.env.local' });
dotenv.config();

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return 'fallback-secret-key';
};

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
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded as any;
    next();
  } catch (err: any) {
    if (err?.message === 'JWT_SECRET is required in production') {
      return res.status(500).json({ error: "Server configuration error" });
    }
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

const buildHeaderIndex = (headers: any[]) =>
  headers.reduce((index: Record<string, number>, header, columnIndex) => {
    index[String(header || '').trim()] = columnIndex;
    return index;
  }, {});

const readCell = (row: any[], index: Record<string, number>, header: string, fallbackIndex: number) => {
  const columnIndex = index[header];
  return row[columnIndex ?? fallbackIndex] ?? '';
};

const parseTaipeiDateMs = (value: any) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const text = String(value).trim();
  const taipeiMatch = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (taipeiMatch) {
    const [, year, month, day, hour, minute, second = '0'] = taipeiMatch;
    return new Date(
      `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second.padStart(2, '0')}+08:00`
    ).getTime();
  }
  const parsed = new Date(text).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const fetchJson = async (url: string, options: RequestInit = {}) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned invalid JSON: ${text.substring(0, 160)}`);
  }
  if (!response.ok) {
    throw new Error(data?.error || `Apps Script returned status: ${response.status}`);
  }
  return data;
};

const getSheetRows = async (scriptUrl: string, sheet: string, ttlMs = 20_000): Promise<SheetRows> => {
  const cacheKey = `${scriptUrl}|${sheet}`;
  const cached = sheetCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  const data = await fetchJson(`${scriptUrl}?action=getData&sheet=${encodeURIComponent(sheet)}`);
  if (data.success === false) {
    if (String(data.error || '').includes('Sheet not found')) return [];
    throw new Error(data.error || `Failed to fetch sheet: ${sheet}`);
  }

  const rows = Array.isArray(data.data) ? data.data : [];
  sheetCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, rows });
  return rows;
};

const getOptionalSheetRows = async (scriptUrl: string, sheet: string, headers: string[] = []) => {
  try {
    const rows = await getSheetRows(scriptUrl, sheet);
    return rows.length ? rows : (headers.length ? [headers] : []);
  } catch (error: any) {
    if (String(error?.message || '').includes('Sheet not found')) {
      return headers.length ? [headers] : [];
    }
    throw error;
  }
};

const invalidateSheetCache = (scriptUrl: string, sheets: string[]) => {
  sheets.forEach((sheet) => sheetCache.delete(`${scriptUrl}|${sheet}`));
};

const getTicketBundleRows = async (scriptUrl: string, ttlMs = 20_000) => {
  const cacheKey = `${scriptUrl}|TicketBundle`;
  const cached = sheetCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const rows = cached.rows as unknown as [SheetRows, SheetRows, SheetRows];
    return { ticketRows: rows[0], relationRows: rows[1], attachmentRows: rows[2], source: 'bundle-cache' };
  }

  try {
    const data = await fetchJson(`${scriptUrl}?action=getTicketBundle`);
    if (data.success !== false && Array.isArray(data.tickets)) {
      const ticketRows = data.tickets || [];
      const relationRows = data.relations || [ticketRelationHeaders];
      const attachmentRows = data.attachmentChecks || [attachmentCheckHeaders];
      const expiresAt = Date.now() + ttlMs;
      sheetCache.set(cacheKey, {
        expiresAt,
        rows: [ticketRows, relationRows, attachmentRows] as unknown as SheetRows
      });
      sheetCache.set(`${scriptUrl}|Tickets`, { expiresAt, rows: ticketRows });
      sheetCache.set(`${scriptUrl}|TicketRelations`, { expiresAt, rows: relationRows });
      sheetCache.set(`${scriptUrl}|AttachmentChecks`, { expiresAt, rows: attachmentRows });
      return { ticketRows, relationRows, attachmentRows, source: 'bundle' };
    }
  } catch (error: any) {
    console.warn('Ticket bundle unavailable, falling back to separate sheet reads:', error.message);
  }

  const [ticketRows, relationRows, attachmentRows] = await Promise.all([
    getSheetRows(scriptUrl, 'Tickets', ttlMs),
    getOptionalSheetRows(scriptUrl, 'TicketRelations', ticketRelationHeaders),
    getOptionalSheetRows(scriptUrl, 'AttachmentChecks', attachmentCheckHeaders)
  ]);
  sheetCache.set(cacheKey, {
    expiresAt: Date.now() + ttlMs,
    rows: [ticketRows, relationRows, attachmentRows] as unknown as SheetRows
  });
  return { ticketRows, relationRows, attachmentRows, source: 'separate' };
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

const ticketHeaders = [
  'TicketID', 'CreatedAt', 'ApplicantEmail', 'ApplicantName', 'Department', 'FormType',
  'Status', 'CurrentStage', 'SLA_Deadline', 'Subject', 'Amount', 'NeedsAML',
  'FormData_JSON', 'CurrentApprover', 'AML_Result', 'AML_Comment', 'RP_Result',
  'RP_Comment', 'AML_LastSyncedAt'
];
const ticketRelationHeaders = [
  'RelationID', 'SourceTicketID', 'TargetTicketID', 'RelationType', 'Note',
  'CreatedBy', 'CreatedAt', 'SourceField', 'Status'
];
const attachmentCheckHeaders = [
  'AttachmentID', 'TicketID', 'FieldKey', 'Url', 'VersionNote', 'CheckStatus',
  'Warning', 'CheckedAt'
];
const meetingRoomHeaders = ['RoomID', 'RoomName', 'Location', 'Capacity', 'IsActive', 'SortOrder', 'OpenTime', 'CloseTime', 'CreatedAt'];
const meetingBookingHeaders = ['BookingID', 'RoomID', 'RoomName', 'BookerEmail', 'BookerName', 'Department', 'Date', 'StartTime', 'EndTime', 'Purpose', 'Status', 'CreatedAt', 'UpdatedAt', 'CancelledAt', 'CancelledBy', 'ReminderSentAt'];

type SheetRows = any[][];

type TicketRecord = {
  id: string;
  createdAt: string;
  applicantEmail: string;
  applicantName: string;
  dept: string;
  formType: string;
  status: string;
  stage: string;
  subject: string;
  amount: string;
  formData: Record<string, any>;
  currentApprover: string;
  amlResult: string;
  amlComment: string;
  rpResult: string;
  rpComment: string;
  amlLastSyncedAt: string;
  relations?: RelationSummary[];
  attachmentWarnings?: AttachmentWarning[];
};

type RelationRow = {
  id: string;
  sourceTicketId: string;
  targetTicketId: string;
  relationType: string;
  note: string;
  createdBy: string;
  createdAt: string;
  sourceField: string;
  status: string;
};

type RelationSummary = RelationRow & {
  direction: 'source' | 'target';
  linkedTicket: TicketBasic | null;
};

type TicketBasic = {
  id: string;
  createdAt: string;
  applicantName: string;
  dept: string;
  formType: string;
  status: string;
  subject: string;
};

type AttachmentWarning = {
  id: string;
  ticketId: string;
  fieldKey: string;
  url: string;
  versionNote: string;
  checkStatus: string;
  warning: string;
  checkedAt: string;
};

const sheetCache = new Map<string, { expiresAt: number; rows: SheetRows }>();

const isAdminUser = (user?: { roles?: string[] }) => user?.roles?.includes('ROLE:ADMIN');

const canAccessBackoffice = (user?: { roles?: string[] }) => {
  const roles = user?.roles || [];
  return roles.some((role) => [
    'ROLE:ADMIN',
    'ROLE:ADMIN_HEAD',
    'ROLE:ADMIN_DIRECTOR',
    'ROLE:FINANCE',
    'ROLE:RISK',
    'ROLE:DEPT_HEAD',
    'ROLE:GM'
  ].includes(role));
};

const isSameUserOrAdmin = (requestedEmail: string, user?: { email?: string; roles?: string[] }) =>
  isAdminUser(user) || String(user?.email || '').toLowerCase() === String(requestedEmail || '').toLowerCase();

const allowedGeneratedFieldTypes = new Set(['text', 'number', 'date', 'select', 'textarea']);
const allowedGeneratedRuleOps = new Set(['ALWAYS', '==', '!=', '>', '>=', '<', '<=', 'IN', 'CONTAINS']);

const normalizeGeneratedFormId = (value: string) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

const normalizeGeneratedHandlingRole = (value: any) => {
  const normalized = String(value || 'ROLE:ADMIN').trim();
  if (!normalized) return 'ROLE:ADMIN';
  return normalized.toUpperCase().startsWith('ROLE:') ? normalized.toUpperCase() : normalized;
};

const normalizeGeneratedFields = (fields: any[] = []) => {
  return fields
    .map((field) => {
      const id = String(field?.id || '').trim().replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
      const type = allowedGeneratedFieldTypes.has(String(field?.type || 'text')) ? String(field.type) : 'text';
      const normalized: any = {
        id,
        label: String(field?.label || id).trim(),
        type,
        required: field?.required !== false
      };
      if (type === 'select') {
        normalized.options = Array.isArray(field?.options) ? field.options.map((option: any) => String(option).trim()).filter(Boolean) : [];
        if (!normalized.options.length) normalized.options = ['是', '否'];
      }
      return normalized;
    })
    .filter((field) => field.id && field.label);
};

const normalizeGeneratedRules = (rules: any[] = []) => {
  return rules.map((rule, index) => ({
    id: String(rule?.id || `rule-${Date.now()}-${index}`),
    ruleName: String(rule?.ruleName || rule?.name || `後台處理規則 ${index + 1}`),
    triggerField: String(rule?.triggerField || rule?.conditionField || 'ALWAYS'),
    triggerOp: allowedGeneratedRuleOps.has(String(rule?.triggerOp || rule?.conditionOp || 'ALWAYS').toUpperCase())
      ? String(rule?.triggerOp || rule?.conditionOp || 'ALWAYS').toUpperCase()
      : 'ALWAYS',
    triggerValue: String(rule?.triggerValue || rule?.conditionVal || ''),
    handlingRole: normalizeGeneratedHandlingRole(rule?.handlingRole || rule?.approverValue || 'ROLE:ADMIN'),
    handlingNote: String(rule?.handlingNote || rule?.note || ''),
    isActive: rule?.isActive === false ? 'FALSE' : 'TRUE'
  }));
};

const rowToObject = (headers: string[], row: any[]) =>
  headers.reduce((record: Record<string, any>, header, index) => {
    record[header] = row[index] ?? '';
    return record;
  }, {});

const mapTicketRow = (headers: any[], row: any[]): TicketRecord => {
  const index = buildHeaderIndex(headers.length ? headers : ticketHeaders);
  const status = String(readCell(row, index, 'Status', 6) || '');
  const isCompleted = status === 'Completed' || status === 'Approved';
  return {
    id: String(readCell(row, index, 'TicketID', 0) || ''),
    createdAt: String(readCell(row, index, 'CreatedAt', 1) || ''),
    applicantEmail: String(readCell(row, index, 'ApplicantEmail', 2) || ''),
    applicantName: String(readCell(row, index, 'ApplicantName', 3) || ''),
    dept: String(readCell(row, index, 'Department', 4) || ''),
    formType: String(readCell(row, index, 'FormType', 5) || ''),
    status,
    stage: isCompleted ? 'END' : String(readCell(row, index, 'CurrentStage', 7) || ''),
    subject: String(readCell(row, index, 'Subject', 9) || ''),
    amount: String(readCell(row, index, 'Amount', 10) || ''),
    formData: parseJsonCell(readCell(row, index, 'FormData_JSON', 12)),
    currentApprover: isCompleted ? '' : String(readCell(row, index, 'CurrentApprover', 13) || ''),
    amlResult: String(readCell(row, index, 'AML_Result', 14) || ''),
    amlComment: String(readCell(row, index, 'AML_Comment', 15) || ''),
    rpResult: String(readCell(row, index, 'RP_Result', 16) || ''),
    rpComment: String(readCell(row, index, 'RP_Comment', 17) || ''),
    amlLastSyncedAt: String(readCell(row, index, 'AML_LastSyncedAt', 18) || '')
  };
};

const toTicketBasic = (ticket: TicketRecord): TicketBasic => ({
  id: ticket.id,
  createdAt: ticket.createdAt,
  applicantName: ticket.applicantName,
  dept: ticket.dept,
  formType: ticket.formType,
  status: ticket.status,
  subject: ticket.subject
});

const mapRelationRow = (headers: any[], row: any[]): RelationRow => {
  const index = buildHeaderIndex(headers.length ? headers : ticketRelationHeaders);
  return {
    id: String(readCell(row, index, 'RelationID', 0) || ''),
    sourceTicketId: String(readCell(row, index, 'SourceTicketID', 1) || ''),
    targetTicketId: String(readCell(row, index, 'TargetTicketID', 2) || ''),
    relationType: String(readCell(row, index, 'RelationType', 3) || ''),
    note: String(readCell(row, index, 'Note', 4) || ''),
    createdBy: String(readCell(row, index, 'CreatedBy', 5) || ''),
    createdAt: String(readCell(row, index, 'CreatedAt', 6) || ''),
    sourceField: String(readCell(row, index, 'SourceField', 7) || ''),
    status: String(readCell(row, index, 'Status', 8) || 'Active')
  };
};

const mapAttachmentRow = (headers: any[], row: any[]): AttachmentWarning => {
  const index = buildHeaderIndex(headers.length ? headers : attachmentCheckHeaders);
  return {
    id: String(readCell(row, index, 'AttachmentID', 0) || ''),
    ticketId: String(readCell(row, index, 'TicketID', 1) || ''),
    fieldKey: String(readCell(row, index, 'FieldKey', 2) || ''),
    url: String(readCell(row, index, 'Url', 3) || ''),
    versionNote: String(readCell(row, index, 'VersionNote', 4) || ''),
    checkStatus: String(readCell(row, index, 'CheckStatus', 5) || ''),
    warning: String(readCell(row, index, 'Warning', 6) || ''),
    checkedAt: String(readCell(row, index, 'CheckedAt', 7) || '')
  };
};

const parseTicketRows = (rows: SheetRows) => {
  const headers = rows[0] || ticketHeaders;
  return rows.slice(1).map((row) => mapTicketRow(headers, row)).filter((ticket) => ticket.id);
};

const parseRelationRows = (rows: SheetRows) => {
  const headers = rows[0] || ticketRelationHeaders;
  return rows.slice(1)
    .map((row) => mapRelationRow(headers, row))
    .filter((relation) => relation.id && relation.sourceTicketId && relation.targetTicketId && relation.status !== 'Deleted');
};

const parseAttachmentRows = (rows: SheetRows) => {
  const headers = rows[0] || attachmentCheckHeaders;
  return rows.slice(1)
    .map((row) => mapAttachmentRow(headers, row))
    .filter((item) => item.id && item.ticketId);
};

const buildTicketContext = (
  tickets: TicketRecord[],
  relations: RelationRow[],
  attachments: AttachmentWarning[]
) => {
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const relationMap = new Map<string, RelationSummary[]>();
  const attachmentMap = new Map<string, AttachmentWarning[]>();

  relations.forEach((relation) => {
    const sourceSummary: RelationSummary = {
      ...relation,
      direction: 'source',
      linkedTicket: ticketById.has(relation.targetTicketId) ? toTicketBasic(ticketById.get(relation.targetTicketId)!) : null
    };
    const targetSummary: RelationSummary = {
      ...relation,
      direction: 'target',
      linkedTicket: ticketById.has(relation.sourceTicketId) ? toTicketBasic(ticketById.get(relation.sourceTicketId)!) : null
    };
    relationMap.set(relation.sourceTicketId, [...(relationMap.get(relation.sourceTicketId) || []), sourceSummary]);
    relationMap.set(relation.targetTicketId, [...(relationMap.get(relation.targetTicketId) || []), targetSummary]);
  });

  attachments
    .filter((item) => item.checkStatus === 'Warning' || item.warning)
    .forEach((item) => {
      attachmentMap.set(item.ticketId, [...(attachmentMap.get(item.ticketId) || []), item]);
    });

  return { ticketById, relationMap, attachmentMap };
};

const enrichTickets = (
  tickets: TicketRecord[],
  relationMap: Map<string, RelationSummary[]>,
  attachmentMap: Map<string, AttachmentWarning[]>
) => tickets.map((ticket) => ({
  ...ticket,
  relations: relationMap.get(ticket.id) || [],
  attachmentWarnings: attachmentMap.get(ticket.id) || []
}));

const isLikelyAttachmentField = (key: string, value: unknown) => {
  const field = key.toLowerCase();
  const text = String(value || '').trim();
  return Boolean(text) && (
    field.includes('attachment') ||
    field.includes('file') ||
    field.includes('document') ||
    /^https?:\/\//i.test(text)
  );
};

const timeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
};

const checkAttachmentUrl = async (url: string) => {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      checkStatus: 'Warning',
      warning: '附件欄位不是 http/https 網址，請確認共用路徑可供查核。'
    };
  }

  try {
    let response = await fetch(trimmed, {
      method: 'HEAD',
      redirect: 'follow',
      signal: timeoutSignal(4_000)
    });
    if (response.status === 405 || response.status === 403) {
      response = await fetch(trimmed, {
        method: 'GET',
        redirect: 'follow',
        signal: timeoutSignal(4_000)
      });
    }
    if (response.status >= 400) {
      return {
        checkStatus: 'Warning',
        warning: `附件連結檢查回應 ${response.status}，請確認權限或網址。`
      };
    }
    return { checkStatus: 'OK', warning: '' };
  } catch (error: any) {
    return {
      checkStatus: 'Warning',
      warning: `附件連結無法完成檢查，請確認權限或網址。${error?.name === 'AbortError' ? '（逾時）' : ''}`
    };
  }
};

const buildAttachmentChecks = async (formData: Record<string, unknown>) => {
  const entries = Object.entries(formData || {}).filter(([key, value]) => isLikelyAttachmentField(key, value));
  const versionNote = String(formData.attachment_version_note || formData.version_note || '').trim();

  return Promise.all(entries.map(async ([fieldKey, rawValue], index) => {
    const url = String(rawValue || '').trim();
    const check = await checkAttachmentUrl(url);
    return {
      attachmentId: `ATT-${Date.now()}-${index + 1}`,
      fieldKey,
      url,
      versionNote,
      checkStatus: check.checkStatus,
      warning: check.warning,
      checkedAt: new Date().toISOString()
    };
  }));
};

const normalizeRpDisplay = (value: string) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.includes('已過關係人會議')) return '已過關係人';
  return text;
};

const escapeXml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const worksheetXml = (name: string, headers: string[], rows: unknown[][]) => {
  const headerXml = headers.map((header) => `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`).join('');
  const rowsXml = rows.map((row) => (
    `<Row>${headers.map((_, index) => `<Cell><Data ss:Type="String">${escapeXml(row[index])}</Data></Cell>`).join('')}</Row>`
  )).join('');
  return `<Worksheet ss:Name="${escapeXml(name)}"><Table><Row>${headerXml}</Row>${rowsXml}</Table></Worksheet>`;
};

const buildExcelWorkbook = (sheets: { name: string; headers: string[]; rows: unknown[][] }[]) => {
  const worksheets = sheets.map((sheet) => worksheetXml(sheet.name, sheet.headers, sheet.rows)).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${worksheets}
</Workbook>`;
};

const matchesAuditFilters = (ticket: TicketRecord, query: Record<string, any>, relations: RelationSummary[] = []) => {
  const search = String(query.search || '').trim().toLowerCase();
  const dept = String(query.dept || '').trim().toLowerCase();
  const formType = String(query.formType || '').trim().toLowerCase();
  const status = String(query.status || '').trim().toLowerCase();
  const taxId = String(query.taxId || '').trim().toLowerCase();
  const relationId = String(query.relationId || '').trim().toLowerCase();
  const dateFrom = String(query.dateFrom || '').trim();
  const dateTo = String(query.dateTo || '').trim();
  const createdAtMs = parseTaipeiDateMs(ticket.createdAt);

  if (dept && !ticket.dept.toLowerCase().includes(dept)) return false;
  if (formType && ticket.formType.toLowerCase() !== formType) return false;
  if (status && ticket.status.toLowerCase() !== status) return false;
  if (taxId && !String(ticket.formData?.ext_tax_id || '').toLowerCase().includes(taxId)) return false;
  if (dateFrom && createdAtMs < new Date(`${dateFrom}T00:00:00+08:00`).getTime()) return false;
  if (dateTo && createdAtMs > new Date(`${dateTo}T23:59:59+08:00`).getTime()) return false;
  if (relationId) {
    const relationText = relations.map((relation) => [
      relation.id,
      relation.sourceTicketId,
      relation.targetTicketId,
      relation.linkedTicket?.id || ''
    ].join(' ')).join(' ').toLowerCase();
    if (!relationText.includes(relationId)) return false;
  }

  if (!search) return true;
  const searchableText = [
    ticket.id,
    ticket.createdAt,
    ticket.applicantEmail,
    ticket.applicantName,
    ticket.dept,
    ticket.formType,
    ticket.status,
    ticket.subject,
    ticket.amount,
    ticket.amlResult,
    ticket.rpResult,
    ...Object.values(ticket.formData || {}).map((value) => String(value ?? '')),
    ...relations.map((relation) => `${relation.id} ${relation.sourceTicketId} ${relation.targetTicketId} ${relation.linkedTicket?.subject || ''}`)
  ].join(' ').toLowerCase();

  return searchableText.includes(search);
};

const normalizeDateCell = (value: any) => {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
};

const normalizeTimeCell = (value: any) => {
  if (!value) return '';
  const text = String(value);
  if (/^\d{2}:\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const parseActiveFlag = (value: any) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return !['FALSE', '0', 'NO', 'N', '停用', '否'].includes(normalized);
};

const mapMeetingRoom = (row: any[]) => {
  const item = rowToObject(meetingRoomHeaders, row);
  return {
    id: item.RoomID,
    name: item.RoomName,
    location: item.Location,
    capacity: item.Capacity,
    isActive: parseActiveFlag(item.IsActive),
    sortOrder: Number(item.SortOrder || 0),
    openTime: normalizeTimeCell(item.OpenTime) || '09:00',
    closeTime: normalizeTimeCell(item.CloseTime) || '18:00',
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
    date: normalizeDateCell(item.Date),
    startTime: normalizeTimeCell(item.StartTime),
    endTime: normalizeTimeCell(item.EndTime),
    purpose: item.Purpose,
    status: item.Status || 'Booked',
    createdAt: item.CreatedAt,
    updatedAt: item.UpdatedAt,
    cancelledAt: item.CancelledAt,
    cancelledBy: item.CancelledBy,
    reminderSentAt: item.ReminderSentAt
  };
};

export async function createApp() {
  const app = express();

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

    let userInfo: any;

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
        } catch(e) {
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

    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
    res.json({ success: true, token, user: payload });
  });

  // 1. Fetch User from Google Sheets via Apps Script (Fallback to Mock if not configured)
  app.get("/api/users/:email", authMiddleware, async (req, res): Promise<any> => {
    const email = req.params.email.toLowerCase();
    if (!isSameUserOrAdmin(email, req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    
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
      }
      return res.status(404).json({ success: false, error: "User not found (Mock)" });
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

    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({
        success: false,
        error: "查無可驗證公司資料，請手動確認統一編號與公司資訊。"
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
      return res.json({ value: "歡迎使用企業內部申請管理系統！\n\n- 若有任何系統操作問題，請聯繫 [IT 資訊處](#)。\n- [點擊此處查看申請流程規範文件](#)" });
    }

    try {
      const rows = await getOptionalSheetRows(scriptUrl, 'SystemSettings', ['Key', 'Value']);
      const settingRow = rows.find((r: any) => r[0] === key);
      res.json({ value: settingRow ? settingRow[1] : "" });
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", authMiddleware, async (req, res): Promise<any> => {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });

    const { key, value } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true });

    try {
      await postToAppsScript(scriptUrl, {
        action: 'saveData',
        sheet: 'SystemSettings',
        matchColumn: 1, // Key
        matchValue: key,
        row: [key, value]
      });
      invalidateSheetCache(scriptUrl, ['SystemSettings']);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving setting:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai-form-model", authMiddleware, async (req, res): Promise<any> => {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });

    const formName = String(req.body.formName || '').trim();
    const formId = normalizeGeneratedFormId(req.body.formId || '');
    const requirement = String(req.body.requirement || '').trim();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!formName || !formId || !requirement) {
      return res.status(400).json({ error: "請填寫完整表單名稱、縮寫代號與需求內容" });
    }
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(500).json({ error: "尚未設定 GEMINI_API_KEY，請先到 Vercel Environment Variables 設定。" });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `你是一個企業內部申請系統的表單規格顧問。

平台背景：
- 這是 21CD 內部申請系統，目前流程是申請人填單、產生單號、寄信、列印申請單、後台人員完成結案。
- 不是線上主管簽核系統，所以請不要設計主管逐關核准語句。
- 所有表單都會由系統額外支援「是否涉及外部合作廠商」及統編/AML 資料欄位，除非使用者明確要求，請避免重複產生 ext_tax_id、ext_company_name、ext_company_owner。
- 欄位 id 請使用英文小寫與底線，欄位型態只能使用 text、number、date、select、textarea。

表單名稱：${formName}
表單代號：${formId}
需求描述：${requirement}

請嚴格回傳 JSON，內容必須包含：
1. fields: 欄位陣列，每個欄位包含 id、label、type、options、required。
2. rules: 後台處理提示規則陣列，每筆包含 ruleName、triggerField、triggerOp、triggerValue、handlingRole、handlingNote、isActive。若沒有特殊後台角色，請給一筆 handlingRole 為 ROLE:ADMIN 的提醒規則。
3. fieldsMarkdown: 給管理員看的 Markdown 欄位清單說明。
4. logicMarkdown: 給管理員看的 Markdown 後台處理流程說明。`;

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
                    ruleName: { type: Type.STRING },
                    triggerField: { type: Type.STRING },
                    triggerOp: { type: Type.STRING },
                    triggerValue: { type: Type.STRING },
                    handlingRole: { type: Type.STRING },
                    handlingNote: { type: Type.STRING },
                    isActive: { type: Type.BOOLEAN }
                  }
                }
              },
              fieldsMarkdown: { type: Type.STRING },
              logicMarkdown: { type: Type.STRING }
            }
          }
        }
      });

      const raw = JSON.parse(response.text || '{}');
      const fields = normalizeGeneratedFields(raw.fields);
      if (!fields.length) throw new Error("AI 未產生可用欄位，請補充需求後再試一次。");

      res.json({
        formId,
        fieldsMarkdown: String(raw.fieldsMarkdown || ''),
        logicMarkdown: String(raw.logicMarkdown || ''),
        fields,
        rules: normalizeGeneratedRules(raw.rules)
      });
    } catch (error: any) {
      console.error("Error generating AI form model:", error);
      res.status(500).json({ error: error.message || "AI 產生表單規格失敗" });
    }
  });
  
  app.get("/api/form-types", authMiddleware, async (req, res): Promise<any> => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.json({ formTypes: defaultFormTypes });
    }

    try {
      const rows = await getOptionalSheetRows(scriptUrl, 'FormTypes', ['FormID', 'FormName']);
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
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });

    const { id, name } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true });

    try {
      await postToAppsScript(scriptUrl, { action: 'addFormType', formId: id, formName: name });
      invalidateSheetCache(scriptUrl, ['FormTypes']);
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

本表單用於一般內部申請與簽呈紀錄，支援涉及外部合作廠商時之動態欄位擴充、公司資訊帶入與 AML/關係人調查勾稽。

| 欄位 ID | 欄位名稱 | 欄位型態 | 必填 | 說明/動態顯示條件 |
| :--- | :--- | :--- | :--- | :--- |
| **related_ticket** | 相關單號 | 單行文字 | 否 | 若本申請延續或補充既有單號，請填入來源單號以利勾稽 |
| **related_case_no** | 相關案件編號 | 單行文字 | 否 | 可填入內部系統案件編號，例如 14 碼案件號；不等同於其他申請單號 |
| **estimated_amount** | 預估金額 | 數值 | 否 | 本案預估金額，會同步作為後台與匯出使用的金額欄位 |
| **subject** | 主旨 | 單行文字 | 是 | 請簡述簽呈之主旨與主要目的 |
| **description** | 內容說明 | 多行文字 | 是 | 詳細說明本簽呈之原因、內容與背景 |
| **attachment** | 附件上傳 | 單行文字 | 否 | 請貼上相關雲端連結或資料夾路徑 |
| **attachment_version_note** | 附件版本/補充說明 | 單行文字 | 否 | 若附件有多版，請補充版本或差異說明 |
| **external_collab** | 是否涉及外部合作廠商 | 下拉選單 | 是 | 可選擇「是」或「否」 |
| **ext_tax_id** | 統一編號/識別碼 | 單行文字 | 是 | 當「是否涉及外部合作廠商」選擇「是」時顯示，輸入後自動帶入廠商與負責人資料 |
| **ext_company_name** | 廠商名稱/公司名稱 | 單行文字 | 是 | 當「是否涉及外部合作廠商」選擇「是」時顯示，自動由 API 帶入，可手動修改 |
| **ext_company_owner** | 負責人姓名 | 單行文字 | 是 | 當「是否涉及外部合作廠商」選擇「是」時顯示，自動由 API 帶入，可手動修改 |
| **applicant_related_party** | 是否為關係人 | 下拉選單 | 否 | 當「是否涉及外部合作廠商」選擇「是」時顯示，供申請人自評留痕；不取代 AML DB 查核結果 |`,
        logicMarkdown: `# 簽呈單 (AP) 後台處理規則

系統負責產生單號、保存申請紀錄、建立關聯線索，並在涉及外部合作廠商時建立 AML/關係人調查資料。

\`\`\`mermaid
graph TD
    Start([申請人送出]) --> Ticket[系統產生 AP 單號]
    Ticket --> Audit[寫入 Tickets 與 AuditLogs]
    Audit --> Cond{涉及外部合作廠商?}
    Cond -- 是 --> AML[建立 AML/關係人調查資料]
    Cond -- 否 --> Backoffice[後台處理與追蹤]
    AML --> Backoffice
    Backoffice --> Done[完成結案並保留稽核軌跡]
\`\`\`

### 後台處理重點

| 項目 | 觸發條件 | 處理重點 |
| :--- | :--- | :--- |
| 單號紀錄 | 送出表單 | 產生 AP 單號並保存申請內容 |
| AML/關係人調查 | external_collab == '是' | 同步 AML 調查資料並回寫查核結果 |
| 單號勾稽 | 申請內容帶有相關單號 | 建立 TicketRelations，供後續查詢與稽核包匯出 |
| 附件檢查 | 附件欄位有值 | 記錄附件版本說明與連結檢查警示 |`,
        configJSON: {
          fields: [
            { id: "related_ticket", label: "相關單號 (選填)", type: "text", required: false },
            { id: "related_case_no", label: "相關案件編號", type: "text", required: false },
            { id: "estimated_amount", label: "預估金額", type: "number", required: false },
            { id: "subject", label: "主旨", type: "text", required: true },
            { id: "description", label: "內容說明", type: "textarea", required: true },
            { id: "attachment", label: "附件上傳 (請貼上雲端連結)", type: "text", required: false },
            { id: "attachment_version_note", label: "附件版本/補充說明", type: "text", required: false },
            { id: "external_collab", label: "是否涉及外部合作廠商", type: "select", options: ["否", "是"], required: true },
            { id: "ext_tax_id", label: "統一編號/識別碼", type: "text", required: true, showIf: { field: "external_collab", value: "是" } },
            { id: "ext_company_name", label: "廠商名稱/公司名稱", type: "text", required: true, showIf: { field: "external_collab", value: "是" } },
            { id: "ext_company_owner", label: "負責人姓名", type: "text", required: true, showIf: { field: "external_collab", value: "是" } },
            { id: "applicant_related_party", label: "是否為關係人", type: "select", options: ["否", "是"], required: false, showIf: { field: "external_collab", value: "是" } }
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
| **amount** | 請款金額 | 數值 | 是 | 本次請款之實際新台幣金額 |
| **external_collab** | 是否涉及外部合作廠商 | 下拉選單 | 是 | 可選擇「是」或「否」 |
| **vendor_name** | 廠商名稱 | 單行文字 | 是 | 當「是否涉及外部合作廠商」為「否」時顯示 |
| **ext_tax_id** | 統一編號/識別碼 | 單行文字 | 是 | 當「是否涉及外部合作廠商」為「是」時顯示，輸入後自動帶入廠商與負責人資料 |
| **ext_company_name** | 廠商名稱/公司名稱 | 單行文字 | 是 | 當「是否涉及外部合作廠商」為「是」時顯示，自動由 API 帶入，可手動修改 |
| **ext_company_owner** | 負責人姓名 | 單行文字 | 是 | 當「是否涉及外部合作廠商」為「是」時顯示，自動由 API 帶入，可手動修改 |
| **payment_date** | 付款期限 | 日期 | 是 | 預計付款之日期 |
| **payment_method** | 付款方式 | 下拉選單 | 是 | 可選擇「匯款」、「現金」或「已由申請人代墊」 |
| **description** | 請款用途說明 | 多行文字 | 是 | 詳細說明本次請款之用途與明細 |
| **attachment** | 檢附單據 | 單行文字 | 是 | 請貼上發票、收據或相關憑證之雲端/共享資料夾連結 |
| **attachment_version_note** | 附件版本/補充說明 | 單行文字 | 否 | 若單據或憑證有多版，請補充版本或差異說明 |`,
        logicMarkdown: `# 請款單 (RD) 後台處理規則

請款單用於請款紀錄、來源單號勾稽、附件管控與財務後台處理追蹤。

\`\`\`mermaid
graph TD
    Start([申請人送出]) --> Ticket[系統產生 RD 單號]
    Ticket --> Relation{有填相關單號?}
    Relation -- 是 --> Link[建立來源單號與 RD 關聯]
    Relation -- 否 --> Record[保存請款資料]
    Link --> Record
    Record --> Attachment[記錄附件與連結警示]
    Attachment --> Finance[財務/後台處理]
    Finance --> Done[完成結案並保留稽核軌跡]
\`\`\`

### 後台處理重點

| 項目 | 觸發條件 | 處理重點 |
| :--- | :--- | :--- |
| 單號紀錄 | 送出表單 | 產生 RD 單號並保存請款資料 |
| 單號勾稽 | related_ticket 有值 | 建立來源單號至本請款單的關聯 |
| AML/關係人調查 | 涉及外部合作廠商且有統編 | 同步 AML 調查資料並回寫查核結果 |
| 附件檢查 | 附件欄位有值 | 記錄附件版本說明與連結檢查警示 |`,
        configJSON: {
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
            { id: "attachment", label: "檢附單據 (請貼上雲端/資料夾連結)", type: "text", required: true },
            { id: "attachment_version_note", label: "附件版本/補充說明", type: "text", required: false }
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
| **attachment** | 用印文件草稿 | 單行文字 | 是 | 請貼上待用印文件草稿之雲端連結 |
| **attachment_version_note** | 附件版本/補充說明 | 單行文字 | 否 | 若文件草稿有多版，請補充版本或差異說明 |`,
        logicMarkdown: `# 用印申請單 (CS) 後台處理規則

用印申請單用於用印需求紀錄、來源單號勾稽、附件版本管控與後台結案追蹤。

\`\`\`mermaid
graph TD
    Start([申請人送出]) --> Ticket[系統產生 CS 單號]
    Ticket --> Relation{有填相關單號?}
    Relation -- 是 --> Link[建立來源單號與 CS 關聯]
    Relation -- 否 --> Record[保存用印資料]
    Link --> Record
    Record --> Attachment[記錄文件版本與連結警示]
    Attachment --> Backoffice[後台處理與用印管制]
    Backoffice --> Done[完成結案並保留稽核軌跡]
\`\`\`

### 後台處理重點

| 項目 | 觸發條件 | 處理重點 |
| :--- | :--- | :--- |
| 單號紀錄 | 送出表單 | 產生 CS 單號並保存用印需求 |
| 單號勾稽 | related_ticket 有值 | 建立來源單號至本用印申請單的關聯 |
| 用印管制 | seal_type 有值 | 後台依公司內控程序處理與結案 |
| 附件檢查 | 附件欄位有值 | 記錄文件版本說明與連結檢查警示 |`,
        configJSON: {
          fields: [
            { id: "related_ticket", label: "相關單號 (搭配請/採購單號)", type: "text", required: false },
            { id: "seal_type", label: "用印類別", type: "select", options: ["經濟部章", "銀行用章", "法務章", "發票章", "合約便章"], required: true },
            { id: "description", label: "用印文件說明", type: "textarea", required: true },
            { id: "attachment", label: "用印文件草稿 (請貼上雲端連結)", type: "text", required: true },
            { id: "attachment_version_note", label: "附件版本/補充說明", type: "text", required: false }
          ]
        }
      }
    ];

    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.json({ definitions: localDefinitions });
    }

    try {
      const rows = await getOptionalSheetRows(scriptUrl, 'FormDefinitions', ['FormID', 'FieldsMarkdown', 'LogicMarkdown', 'ConfigJSON']);
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
          const forceLocalDefinition = ['AP', 'RD', 'CS'].includes(def.formId);
          return {
            ...def,
            fieldsMarkdown: forceLocalDefinition ? local.fieldsMarkdown : ((def.fieldsMarkdown && def.fieldsMarkdown.trim()) ? def.fieldsMarkdown : local.fieldsMarkdown),
            logicMarkdown: forceLocalDefinition ? local.logicMarkdown : ((def.logicMarkdown && def.logicMarkdown.trim()) ? def.logicMarkdown : local.logicMarkdown),
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
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });

    const { formId } = req.params;
    const { fieldsMarkdown, logicMarkdown, configJSON } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.status(500).json({ error: "GAS URL not configured" });

    try {
      await postToAppsScript(scriptUrl, {
        action: 'saveData',
        sheet: 'FormDefinitions',
        matchColumn: 1, // FormID
        matchValue: formId,
        row: [formId, fieldsMarkdown, logicMarkdown, JSON.stringify(configJSON)]
      });
      invalidateSheetCache(scriptUrl, ['FormDefinitions']);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving form definition:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/rules/:formType", authMiddleware, async (req, res): Promise<any> => {
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
      const headers = rows[0] || [];
      const headerIndex = buildHeaderIndex(headers);
      const isLegacyWorkflow = headerIndex.Stage != null || headerIndex.ApproverType != null;
      const rules = rows.slice(1).map((r: any, index: number) => isLegacyWorkflow ? ({
        id: r[0] || `legacy-${index}`,
        ruleName: `舊規則第 ${r[2] || index + 1} 筆`,
        triggerField: r[3] || 'ALWAYS',
        triggerOp: r[4] || 'ALWAYS',
        triggerValue: r[5] || '',
        handlingRole: normalizeGeneratedHandlingRole(r[7] || r[6] || 'ROLE:ADMIN'),
        handlingNote: '由舊 WorkflowRules 轉換顯示，請儲存後改用新版後台處理規則。',
        isActive: 'FALSE'
      }) : ({
        id: readCell(r, headerIndex, 'RuleID', 0),
        ruleName: readCell(r, headerIndex, 'RuleName', 2),
        triggerField: readCell(r, headerIndex, 'TriggerField', 3),
        triggerOp: readCell(r, headerIndex, 'TriggerOp', 4),
        triggerValue: readCell(r, headerIndex, 'TriggerValue', 5),
        handlingRole: normalizeGeneratedHandlingRole(readCell(r, headerIndex, 'HandlingRole', 6)),
        handlingNote: readCell(r, headerIndex, 'HandlingNote', 7),
        isActive: readCell(r, headerIndex, 'IsActive', 8) || 'TRUE'
      }));
      rules.sort((a: any, b: any) => String(a.ruleName || '').localeCompare(String(b.ruleName || ''), 'zh-Hant'));
      res.json({ rules });
    } catch (error) {
      console.error("Error fetching rules:", error);
      res.status(500).json({ error: "Failed to fetch rules" });
    }
  });

  app.post("/api/rules/:formType", authMiddleware, async (req, res): Promise<any> => {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });

    const { formType } = req.params;
    const { rules } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true });

    try {
      const rows = rules.map((r: any) => [
        r.id,
        formType,
        r.ruleName || '',
        r.triggerField || 'ALWAYS',
        r.triggerOp || 'ALWAYS',
        r.triggerValue || '',
        normalizeGeneratedHandlingRole(r.handlingRole),
        r.handlingNote || '',
        r.isActive === false || r.isActive === 'FALSE' ? 'FALSE' : 'TRUE',
        new Date().toISOString()
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
      const { tickets } = req.body;
      const firstTicket = tickets?.[0];
      if (!firstTicket) return res.status(400).json({ error: "Missing ticket payload" });
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const applicantEmail = req.user.email;
      const applicantName = req.user.name;
      const department = req.user.dept;

      const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
      if (!scriptUrl) {
        const mockId = `${firstTicket.formType || 'AP'}${extractDeptCode(department)}${new Date().toISOString().slice(0, 10).replace(/-/g, '')}001`;
        return res.json({ success: true, generatedIds: [mockId], applicationNumber: mockId, source: 'mock' });
      }

      const attachmentChecks = await buildAttachmentChecks(firstTicket.formData || {});
      const result = await postToAppsScript(scriptUrl, {
        action: 'submitApplication',
        applicantEmail,
        applicantName,
        department,
        formType: firstTicket.formType,
        subject: firstTicket.subject || '',
        amount: firstTicket.amount || '',
        formData: firstTicket.formData || {},
        attachmentChecks
      });
      invalidateSheetCache(scriptUrl, ['Tickets', 'AuditLogs', 'TicketRelations', 'AttachmentChecks', 'TicketBundle']);

      return res.json({
        success: true,
        generatedIds: [result.applicationNumber],
        applicationNumber: result.applicationNumber,
        amlStatus: result.amlStatus,
        attachmentWarnings: attachmentChecks.filter((item) => item.checkStatus === 'Warning' || item.warning)
      });
    } catch (error: any) {
      console.error("Error submitting application:", error);
      return res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  // 4.5 Resubmit Ticket
  app.post("/api/tickets/:ticketId/resubmit", authMiddleware, async (req, res): Promise<any> => {
    const { ticketId } = req.params;
    const { formData = {}, amount, subject } = req.body;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    if (ticketId.startsWith('DEMO-')) {
      await new Promise(resolve => setTimeout(resolve, 800));
      return res.json({ success: true, message: "Demo resubmit successful" });
    }

    if (!scriptUrl) {
      return res.json({ success: true, message: "Mock resubmit successful" });
    }

    try {
      const ticketRows = await getSheetRows(scriptUrl, 'Tickets');
      const tickets = parseTicketRows(ticketRows);
      const ticket = tickets.find((item) => item.id === ticketId);
      if (!ticket) throw new Error("Ticket not found");

      const applicantEmail = String(ticket.applicantEmail || '').toLowerCase();
      if (!isSameUserOrAdmin(applicantEmail, req.user)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (String(ticket.status || '') !== 'Rejected') {
        return res.status(400).json({ error: "Only rejected tickets can be resubmitted" });
      }

      const attachmentChecks = await buildAttachmentChecks(formData);
      const result = await postToAppsScript(scriptUrl, {
        action: 'resubmitTicket',
        ticketId,
        status: 'Submitted',
        stage: '',
        nextApprover: '',
        subject,
        amount,
        formData,
        actorEmail: req.user?.email || applicantEmail,
        attachmentChecks
      });
      invalidateSheetCache(scriptUrl, ['Tickets', 'AuditLogs', 'TicketRelations', 'AttachmentChecks', 'TicketBundle']);
      
      res.json({ success: true, newStatus: 'Submitted', newStage: '', newApprover: '', attachmentWarnings: attachmentChecks.filter((item) => item.checkStatus === 'Warning' || item.warning), result });
    } catch (error: any) {
      console.error("Error resubmitting ticket:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // 5. Fetch My Own Submitted Tickets
  app.get("/api/tickets/my/:email", authMiddleware, async (req, res): Promise<any> => {
    const email = req.params.email.toLowerCase();
    if (!isSameUserOrAdmin(email, req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    // Demo tickets for testing the UI
    const mockTickets = [
      { id: 'DEMO-AP-001', createdAt: new Date().toISOString(), applicantEmail: email, applicantName: '展示測試員', dept: '測試部門', formType: 'AP', subject: '行銷合作專案簽呈', amount: '', status: 'Pending', stage: '', currentApprover: '', formData: { apSubject: '行銷合作專案簽呈', apDesc: '說明內容', external_collab: 'true', ext_company_name: '外部測試公司' } },
      { id: 'DEMO-CS-002', createdAt: new Date(Date.now() - 86400000).toISOString(), applicantEmail: email, applicantName: '展示測試員', dept: '測試部門', formType: 'CS', subject: '經濟部變更登記用印', amount: '', status: 'Approved', stage: 'END', currentApprover: '', formData: { seal_type: '經濟部章', cs_desc: '需要用印' } }
    ];

    if (!scriptUrl) {
      return res.json({ tickets: [mockTickets[0], mockTickets[1]], source: 'mock' });
    }

    try {
      const { ticketRows, relationRows, attachmentRows } = await getTicketBundleRows(scriptUrl);
      const allTickets = parseTicketRows(ticketRows);
      const allRelations = parseRelationRows(relationRows);
      const allAttachments = parseAttachmentRows(attachmentRows);
      const { relationMap, attachmentMap } = buildTicketContext(allTickets, allRelations, allAttachments);
      const myTickets = enrichTickets(
        allTickets.filter((ticket) => ticket.applicantEmail.toLowerCase() === email),
        relationMap,
        attachmentMap
      ).map((ticket) => ({ ...ticket, currentApprover: '', rpResult: normalizeRpDisplay(ticket.rpResult) }));

      // Sort by createdAt descending
      myTickets.sort((a: any, b: any) => parseTaipeiDateMs(b.createdAt) - parseTaipeiDateMs(a.createdAt));

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
    if (!canAccessBackoffice(req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!scriptUrl) {
      return res.json({ tickets: [], source: 'mock' });
    }

    try {
      const { ticketRows, relationRows, attachmentRows } = await getTicketBundleRows(scriptUrl);
      const allTickets = parseTicketRows(ticketRows);
      const allRelations = parseRelationRows(relationRows);
      const allAttachments = parseAttachmentRows(attachmentRows);
      const { relationMap, attachmentMap } = buildTicketContext(allTickets, allRelations, allAttachments);
      const tickets = enrichTickets(allTickets, relationMap, attachmentMap)
        .map((ticket) => ({ ...ticket, rpResult: normalizeRpDisplay(ticket.rpResult) }))
        .sort((a: any, b: any) => parseTaipeiDateMs(b.createdAt) - parseTaipeiDateMs(a.createdAt));

      res.json({ tickets });
    } catch (error: any) {
      console.error("Error fetching backoffice tickets:", error);
      res.status(500).json({ error: error.message || "Failed to fetch backoffice tickets" });
    }
  });

  app.post("/api/tickets/:ticketId/complete", authMiddleware, async (req, res): Promise<any> => {
    if (!canAccessBackoffice(req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) return res.json({ success: true, source: 'mock' });

    try {
      const result = await postToAppsScript(scriptUrl, {
        action: 'completeTicket',
        ticketId: req.params.ticketId,
        completedBy: req.user?.email,
        note: req.body?.note || ''
      });
      invalidateSheetCache(scriptUrl, ['Tickets', 'AuditLogs', 'TicketBundle']);
      res.json(result);
    } catch (error: any) {
      console.error("Error completing ticket:", error);
      res.status(500).json({ error: error.message || "Failed to complete ticket" });
    }
  });

  app.get("/api/tickets/:ticketId/relations", authMiddleware, async (req, res): Promise<any> => {
    const { ticketId } = req.params;
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl || ticketId.startsWith('DEMO-')) {
      return res.json({ relations: [], source: 'mock' });
    }

    try {
      const [ticketRows, relationRows, attachmentRows] = await Promise.all([
        getSheetRows(scriptUrl, 'Tickets'),
        getOptionalSheetRows(scriptUrl, 'TicketRelations', ticketRelationHeaders),
        getOptionalSheetRows(scriptUrl, 'AttachmentChecks', attachmentCheckHeaders)
      ]);
      const allTickets = parseTicketRows(ticketRows);
      const requestedTicket = allTickets.find((ticket) => ticket.id === ticketId);
      if (!requestedTicket) return res.status(404).json({ error: "Ticket not found" });

      const ownsTicket = requestedTicket.applicantEmail.toLowerCase() === req.user?.email.toLowerCase();
      if (!ownsTicket && !canAccessBackoffice(req.user)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const allRelations = parseRelationRows(relationRows);
      const allAttachments = parseAttachmentRows(attachmentRows);
      const { relationMap } = buildTicketContext(allTickets, allRelations, allAttachments);
      res.json({ relations: relationMap.get(ticketId) || [] });
    } catch (error: any) {
      console.error("Error fetching ticket relations:", error);
      res.status(500).json({ error: error.message || "Failed to fetch ticket relations" });
    }
  });

  app.post("/api/backoffice/sync-aml-rp", authMiddleware, async (req, res): Promise<any> => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!canAccessBackoffice(req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!scriptUrl) return res.status(503).json({ error: "GAS URL not configured" });

    try {
      const result = await postToAppsScript(scriptUrl, { action: 'syncAmlRpResults' });
      invalidateSheetCache(scriptUrl, ['Tickets', 'TicketBundle']);
      res.json(result);
    } catch (error: any) {
      console.error("Error syncing AML/RP results:", error);
      res.status(500).json({ error: error.message || "Failed to sync AML/RP results" });
    }
  });

  app.get("/api/backoffice/audit-export", authMiddleware, async (req, res): Promise<any> => {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!canAccessBackoffice(req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!scriptUrl) return res.status(503).json({ error: "GAS URL not configured" });

    try {
      if (String(req.query.sync || '').toLowerCase() === 'true') {
        await postToAppsScript(scriptUrl, { action: 'syncAmlRpResults' }).catch((error) => {
          console.warn('AML/RP sync skipped before audit export:', error.message);
        });
        invalidateSheetCache(scriptUrl, ['Tickets', 'TicketBundle']);
      }

      const [{ ticketRows, relationRows, attachmentRows }, logRows, amlResult] = await Promise.all([
        getTicketBundleRows(scriptUrl, 5_000),
        getOptionalSheetRows(scriptUrl, 'AuditLogs', ['TicketID', 'ActionType', 'ApproverID', 'Stage', 'Comment', 'Timestamp']),
        fetchJson(`${scriptUrl}?action=getAmlData`).catch(() => ({ success: true, data: [] }))
      ]);

      const allTickets = parseTicketRows(ticketRows);
      const allRelations = parseRelationRows(relationRows);
      const allAttachments = parseAttachmentRows(attachmentRows);
      const { relationMap } = buildTicketContext(allTickets, allRelations, allAttachments);
      const tickets = allTickets
        .filter((ticket) => matchesAuditFilters(ticket, req.query, relationMap.get(ticket.id) || []))
        .sort((a, b) => parseTaipeiDateMs(b.createdAt) - parseTaipeiDateMs(a.createdAt));
      const selectedTicketIds = new Set(tickets.map((ticket) => ticket.id));

      const logs = (logRows || []).slice(1).filter((row) => selectedTicketIds.has(String(row[0] || '')));
      const relations = allRelations.filter((relation) =>
        selectedTicketIds.has(relation.sourceTicketId) || selectedTicketIds.has(relation.targetTicketId)
      );
      const attachments = allAttachments.filter((item) => selectedTicketIds.has(item.ticketId));
      const amlRows = Array.isArray(amlResult.data) ? amlResult.data : [];
      const amlHeaders = amlRows[0] || [];
      const amlIndex = buildHeaderIndex(amlHeaders);
      const amlTicketIndex = amlIndex['表單編號'] ?? 2;
      const amlRecords = amlRows.slice(1).filter((row: any[]) => selectedTicketIds.has(String(row[amlTicketIndex] || '')));

      const workbook = buildExcelWorkbook([
        {
          name: 'Tickets',
          headers: ['單號', '建立時間', '申請人', '部門', '表單', '狀態', '主旨', '金額', '相關案件編號', '統編', '商家', '申請人自評關係人', 'AML結果', '關係人結果', '關聯數', '附件警示數'],
          rows: tickets.map((ticket) => [
            ticket.id,
            ticket.createdAt,
            `${ticket.applicantName} (${ticket.applicantEmail})`,
            ticket.dept,
            ticket.formType,
            ticket.status,
            ticket.subject,
            ticket.amount,
            ticket.formData?.related_case_no || '',
            ticket.formData?.ext_tax_id || '',
            ticket.formData?.ext_company_name || ticket.formData?.vendor_name || '',
            ticket.formData?.applicant_related_party || '',
            ticket.amlResult,
            normalizeRpDisplay(ticket.rpResult),
            relationMap.get(ticket.id)?.length || 0,
            allAttachments.filter((item) => item.ticketId === ticket.id && (item.checkStatus === 'Warning' || item.warning)).length
          ])
        },
        {
          name: 'AuditLogs',
          headers: ['單號', '動作', '操作人', '階段', '備註', '時間'],
          rows: logs.map((row) => [row[0], row[1], row[2], row[3], row[4], row[5]])
        },
        {
          name: 'Relations',
          headers: ['關聯ID', '來源單號', '目標單號', '關係說明', '備註', '建立人', '建立時間', '來源欄位', '狀態'],
          rows: relations.map((relation) => [
            relation.id,
            relation.sourceTicketId,
            relation.targetTicketId,
            relation.relationType,
            relation.note,
            relation.createdBy,
            relation.createdAt,
            relation.sourceField,
            relation.status
          ])
        },
        {
          name: 'AML_RP',
          headers: amlHeaders.length ? amlHeaders.map(String) : ['無 AML 資料'],
          rows: amlRecords.length ? amlRecords : []
        },
        {
          name: 'Attachments',
          headers: ['附件ID', '單號', '欄位', '連結', '版本說明', '檢查狀態', '警示', '檢查時間'],
          rows: attachments.map((item) => [
            item.id,
            item.ticketId,
            item.fieldKey,
            item.url,
            item.versionNote,
            item.checkStatus,
            item.warning,
            item.checkedAt
          ])
        }
      ]);

      const filename = `audit-export-${new Date().toISOString().slice(0, 10)}.xls`;
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(workbook);
    } catch (error: any) {
      console.error("Error exporting audit package:", error);
      res.status(500).json({ error: error.message || "Failed to export audit package" });
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
          isActive: parseActiveFlag(req.body.isActive),
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

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  return app;
}
