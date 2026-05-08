const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxPxIPLrvil9a4x6YCPlML1gvrvxHzBLyCkGMRkU3YhVa8tYsiiErqLvUdNom073_C_ag/exec';

export const APPS_SCRIPT_URL =
  (import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL as string | undefined) || DEFAULT_APPS_SCRIPT_URL;

export const USE_APPS_SCRIPT_DIRECT = import.meta.env.PROD;

type QueryValue = string | number | boolean | undefined | null;
type JsonObject = Record<string, unknown>;

interface FormTypeOption {
  id: string;
  name: string;
}

function buildUrl(base: string, query?: Record<string, QueryValue>) {
  const url = new URL(base);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

export async function apiGet<T>(path: string, appsScriptQuery?: Record<string, QueryValue>): Promise<T> {
  const url = USE_APPS_SCRIPT_DIRECT
    ? buildUrl(APPS_SCRIPT_URL, appsScriptQuery)
    : path;

  const res = await fetch(url, USE_APPS_SCRIPT_DIRECT ? { method: 'GET', mode: 'cors' } : undefined);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status}`);
  }

  const data = await parseJsonResponse<T>(res);
  return normalizeAppsScriptGetResponse(path, data) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const url = USE_APPS_SCRIPT_DIRECT ? APPS_SCRIPT_URL : path;
  const payload = USE_APPS_SCRIPT_DIRECT ? toAppsScriptPayload(path, body) : body;

  const res = USE_APPS_SCRIPT_DIRECT
    ? await fetch(url, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      })
    : await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

  const data = await parseJsonResponse<any>(res);
  if (!res.ok) {
    throw new Error(data?.error || `POST ${url} failed: ${res.status}`);
  }

  if (data && typeof data === 'object' && data.success === false) {
    throw new Error(data.error || 'Request failed');
  }

  return data as T;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }
}

function normalizeAppsScriptGetResponse(path: string, data: unknown): unknown {
  if (!USE_APPS_SCRIPT_DIRECT || !data || typeof data !== 'object') {
    return data;
  }

  if (path === '/api/form-types') {
    const raw = data as { formTypes?: FormTypeOption[]; data?: unknown };
    if (Array.isArray(raw.formTypes)) {
      return raw;
    }

    const rows = Array.isArray(raw.data) ? raw.data : [];
    const formTypes = rows
      .slice(1)
      .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 2)
      .map((row) => ({
        id: String(row[0] ?? ''),
        name: String(row[1] ?? ''),
      }))
      .filter((row) => row.id && row.name);

    return { ...raw, formTypes };
  }

  return data;
}

function toAppsScriptPayload(path: string, body: unknown): unknown {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const data = body as JsonObject;

  if (path === '/api/submit-approval') {
    return mapSubmitApprovalPayload(data);
  }

  if (path === '/api/settings') {
    return {
      action: 'saveSetting',
      key: String(data.key || ''),
      value: String(data.value || ''),
    };
  }

  if (path.includes('/api/tickets/') && path.endsWith('/action')) {
    const ticketId = decodeURIComponent(path.split('/')[3] || '');
    return {
      action: 'updateTicketActionProxy',
      ticketId,
      ...data,
    };
  }

  return body;
}

function mapSubmitApprovalPayload(data: JsonObject) {
  const applicantEmail = String(data.applicantEmail || '');
  const applicantName = String(data.applicantName || '');
  const department = String(data.department || '');
  const tickets = Array.isArray(data.tickets) ? data.tickets : [];

  const rows = tickets.map((ticket: any) => {
    const createdAt = new Date();
    const slaDeadline = new Date(createdAt.getTime() + 60 * 24 * 60 * 60 * 1000);

    return [
      ticket.id,
      createdAt.toISOString(),
      applicantEmail,
      applicantName,
      department,
      ticket.formType,
      'Pending',
      '1',
      slaDeadline.toISOString(),
      ticket.subject || '',
      ticket.amount || '',
      'FALSE',
      JSON.stringify(ticket.formData || {}),
      '',
    ];
  });

  return {
    action: 'submitTickets',
    rows,
  };
}
