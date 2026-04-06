import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupDevice } from '../lib/api.js';
import Visualization from '../components/Visualization.js';

const noopAmplitude = () => 0.15; // gentle idle pattern on setup screen
const noopConnect = () => {};
const noopElement = () => null;

export default function Setup() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await setupDevice(email.trim(), password);
      localStorage.setItem('device_token', result.device_token);
      localStorage.setItem('store_id', result.store_id);
      localStorage.setItem('store_name', result.store_name);
      localStorage.setItem('client_name', result.client_name);
      if (result.default_mode) localStorage.setItem('default_mode', result.default_mode);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && email.trim() && password) handleSubmit();
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 0', fontSize: 14, fontWeight: 300, fontFamily: "'Inter', sans-serif",
    color: 'rgba(255,255,255,0.7)', background: 'transparent', border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.18)', outline: 'none', letterSpacing: 0.5,
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Visualization getAmplitude={noopAmplitude} connectAnalyser={noopConnect} getActiveElement={noopElement} songId={null} />

      <div style={{
        position: 'relative', zIndex: 1, width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ width: '100%', maxWidth: 320, textAlign: 'center' }} onKeyDown={handleKeyDown}>
          {/* Logo */}
          <div style={{ marginBottom: 48 }}>
            <img src="/logo.svg" alt="Entuned" style={{ height: 48, opacity: 1 }} />
          </div>

          {/* Email input */}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ ...inputStyle, marginBottom: 24 }}
          />

          {/* Password input */}
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ ...inputStyle, marginBottom: error ? 12 : 40 }}
          />

          {/* Error */}
          {error && (
            <div style={{ fontSize: 12, color: 'rgba(240,153,123,0.6)', marginBottom: 16, textAlign: 'left' }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !email.trim() || !password}
            style={{
              width: '100%', height: 48, borderRadius: 24,
              border: '1px solid rgba(212,225,229,0.2)',
              background: 'transparent', cursor: loading ? 'wait' : 'pointer',
              fontSize: 13, fontWeight: 300, letterSpacing: 3,
              textTransform: 'uppercase', color: 'rgba(212,225,229,0.6)',
              fontFamily: "'Inter', sans-serif",
              opacity: loading || !email.trim() || !password ? 0.4 : 1,
              transition: 'border-color 0.3s, background 0.3s',
              outline: 'none',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(212,225,229,0.4)'; e.currentTarget.style.background = 'rgba(212,225,229,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(212,225,229,0.2)'; e.currentTarget.style.background = 'transparent'; }}
          >
            {loading ? 'CONNECTING...' : 'CONNECT'}
          </button>
        </div>
      </div>
    </div>
  );
}
