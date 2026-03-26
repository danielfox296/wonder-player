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

export async function setupDevice(email: string, password: string) {
  const res = await fetch(`${API}/api/player/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Setup failed');
  return data.data as { device_token: string; store_id: string; store_name: string; client_name: string };
}
