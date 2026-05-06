const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxPxIPLrvil9a4x6YCPlML1gvrvxHzBLyCkGMRkU3YhVa8tYsiiErqLvUdNom073_C_ag/exec';

export const APPS_SCRIPT_URL =
  (import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL as string | undefined) || DEFAULT_APPS_SCRIPT_URL;

export const USE_APPS_SCRIPT_DIRECT = import.meta.env.PROD;

type QueryValue = string | number | boolean | undefined | null;

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
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status}`);
  }

  return res.json();
}
