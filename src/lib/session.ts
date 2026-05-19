export type SessionUser = {
  email: string;
  name: string;
  dept: string;
  manager: string;
  roles: string[];
};

const SESSION_STORAGE_KEY = 'signing-system-session-user';

export function loadSessionUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SessionUser;
    if (!parsed?.email || !Array.isArray(parsed.roles)) {
      return null;
    }

    return {
      email: String(parsed.email || '').toLowerCase().trim(),
      name: String(parsed.name || ''),
      dept: String(parsed.dept || ''),
      manager: String(parsed.manager || ''),
      roles: parsed.roles.map((role) => String(role || '')).filter(Boolean),
    };
  } catch {
    return null;
  }
}

export function saveSessionUser(user: SessionUser | null) {
  if (typeof window === 'undefined') return;

  if (!user) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
}
