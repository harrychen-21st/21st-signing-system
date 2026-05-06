const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxPxIPLrvil9a4x6YCPlML1gvrvxHzBLyCkGMRkU3YhVa8tYsiiErqLvUdNom073_C_ag/exec';

export const APPS_SCRIPT_URL =
  (import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL as string | undefined) || DEFAULT_APPS_SCRIPT_URL;

export const USE_APPS_SCRIPT_DIRECT = import.meta.env.PROD;

type QueryValue = string | number | boolean | undefined | null;
type JsonObject = Record<string, unknown>;

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

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status}`);
  }

  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const url = USE_APPS_SCRIPT_DIRECT ? APPS_SCRIPT_URL : path;
  const payload = USE_APPS_SCRIPT_DIRECT ? toAppsScriptPayload(path, body) : body;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`POST ${url} failed: ${res.status}`);
  }

  return res.json();
}

function toAppsScriptPayload(path: string, body: unknown): unknown {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const data = body as JsonObject;

  if (path === '/api/submit-approval') {
    return mapSubmitApprovalPayload(data);
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
