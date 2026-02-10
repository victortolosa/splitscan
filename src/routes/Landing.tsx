import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dataClient } from '../lib/data';
import { addRecentSession, getRecentSessions } from '../lib/session';

export function Landing() {
  const navigate = useNavigate();
  const [joinId, setJoinId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recent = useMemo(() => getRecentSessions(), []);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await dataClient.createSession();
      navigate(`/${session.id}`);
    } catch (err) {
      setError('Unable to create a session. Check your Firebase config or use local mode.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = (event: FormEvent) => {
    event.preventDefault();
    if (!joinId.trim()) {
      return;
    }
    const id = joinId.trim();
    addRecentSession(id);
    navigate(`/${id}`);
  };

  return (
    <div className="app-shell">
      <div className="brand">
        <span className="brand-dot" />
        SplitScan
      </div>

      <section className="hero">
        <div className="fade-in">
          <h1>Split receipts with live clarity.</h1>
          <p>
            Launch a shared session, enter items manually or with OCR later, and keep every total in sync for
            everyone at the table. No accounts, no friction.
          </p>
          <button className="button primary" onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating...' : 'Create New Bill'}
          </button>
        </div>

        <div className="panel slide-up">
          <h2>Join a session</h2>
          <p>Paste a shared ID to jump straight into the workspace.</p>
          <form onSubmit={handleJoin} className="grid">
            <label className="sr-only" htmlFor="join-session-id">
              Session ID
            </label>
            <input
              id="join-session-id"
              className="input"
              placeholder="Session ID"
              value={joinId}
              onChange={(event) => setJoinId(event.target.value)}
            />
            <button className="button secondary" type="submit">
              Join Session
            </button>
          </form>
          {error && <p className="notice">{error}</p>}
        </div>
      </section>

      <section>
        <div className="panel">
          <h2>Recent sessions</h2>
          {recent.length === 0 ? (
            <p className="caption">No recent sessions yet.</p>
          ) : (
            <div className="list">
              {recent.map((id) => (
                <a key={id} className="list-item" href={`/${id}`}>
                  <span>{id}</span>
                  <span className="caption">Open</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
