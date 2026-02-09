const CLIENT_ID_KEY = 'splitscan_client_id';
const RECENT_KEY = 'splitscan_recent_sessions';
const GROUP_KEY_PREFIX = 'splitscan_active_group_';

function base64Url(bytes: Uint8Array) {
  const raw = String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generateId(length = 12) {
  const bytes = new Uint8Array(Math.ceil((length * 3) / 4));
  crypto.getRandomValues(bytes);
  return base64Url(bytes).slice(0, length);
}

export function getClientId() {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }
  const id = generateId(14);
  localStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}

export function addRecentSession(id: string) {
  const raw = localStorage.getItem(RECENT_KEY);
  const existing = raw ? (JSON.parse(raw) as string[]) : [];
  const next = [id, ...existing.filter((item) => item !== id)].slice(0, 5);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

export function getRecentSessions() {
  const raw = localStorage.getItem(RECENT_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export function setActiveGroup(sessionId: string, groupId: string | null) {
  const key = `${GROUP_KEY_PREFIX}${sessionId}`;
  if (groupId) {
    localStorage.setItem(key, groupId);
  } else {
    localStorage.removeItem(key);
  }
}

export function getActiveGroup(sessionId: string) {
  const key = `${GROUP_KEY_PREFIX}${sessionId}`;
  return localStorage.getItem(key);
}
