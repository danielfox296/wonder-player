const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function getToken(): string | null {
  return localStorage.getItem('device_token');
}

export async function playerApi<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Device ${token}`;

  const res = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (res.status === 401) {
    localStorage.removeItem('device_token');
    localStorage.removeItem('store_id');
    localStorage.removeItem('store_name');
    window.location.href = '/setup';
    throw new Error('Unauthorized');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Request failed: ${res.status}`);
  return data;
}

export async function sendFeedback(song_id: string, type: 'love' | 'report', reason?: string) {
  return playerApi('/api/player/feedback', { method: 'POST', body: { song_id, type, reason } });
}

export async function getNextTrack(mode: string, excludeIds: string[]) {
  const exclude = excludeIds.join(',');
  return playerApi<{ data: { id: string; title: string | null; audio_url: string; duration_seconds: number } }>(`/api/player/next-track?mode=${encodeURIComponent(mode)}&exclude=${encodeURIComponent(exclude)}`);
}

export async function logModeChange(previousMode: string | null, newMode: string) {
  return playerApi('/api/player/events/mode-change', {
    method: 'POST',
    body: { previous_mode: previousMode, new_mode: newMode },
  });
}

// v3 — resolve the store's current stream window from StreamPlan + clock.
// Returns the active mode + optional outcome + the window label. Falls back
// to the store's default_mode if no plan or no window covers the current moment.
export async function getCurrentStream() {
  return playerApi<{
    data: {
      active_mode: { slug: string; name: string; descriptor: string | null };
      active_outcome: { slug: string; name: string } | null;
      active_window: { id: string; label: string | null; start_time: string; end_time: string; day_of_week: number } | null;
      resolved_at: string;
      timezone_used: string;
      fallback_reason?: string;
    };
  }>(`/api/player/current-stream`);
}

export async function setupDevice(email: string, password: string) {
  const res = await fetch(`${API}/api/player/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Setup failed');
  return data.data as { device_token: string; store_id: string; store_name: string; client_name: string; default_mode: string };
}
