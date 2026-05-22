import { useState, type FormEvent } from 'react';
import { useGameApi } from '../api/context.js';
import { ApiError } from '../api/client.js';
import { useSession } from '../store/session.js';
import { navigate } from '../router/hash.js';
import {
  CIV_OPTIONS,
  validateGameCode,
  validateName,
} from '../lib/validation.js';
import type { Civ } from '@eoe/schema';

type Tab = 'create' | 'join';

export const Home = (): JSX.Element => {
  const [tab, setTab] = useState<Tab>('create');
  return (
    <main className="home">
      <h1>Echoes of Emperors</h1>
      <p className="subtitle">MVP-1 shell — join a game by code</p>
      <div role="tablist" aria-label="Home actions" className="tabs">
        <button
          role="tab"
          data-testid="tab-create"
          aria-selected={tab === 'create'}
          onClick={() => setTab('create')}
        >
          Create game
        </button>
        <button
          role="tab"
          data-testid="tab-join"
          aria-selected={tab === 'join'}
          onClick={() => setTab('join')}
        >
          Join game
        </button>
      </div>
      {tab === 'create' ? <CreateForm /> : <JoinForm />}
    </main>
  );
};

const CreateForm = (): JSX.Element => {
  const api = useGameApi();
  const setMembership = useSession((s) => s.setMembership);
  const setCurrentGame = useSession((s) => s.setCurrentGame);
  const setPollState = useSession((s) => s.setPollState);
  const pollState = useSession((s) => s.pollState);
  const storeError = useSession((s) => s.error);

  const [name, setName] = useState('');
  const [civ, setCiv] = useState<Civ>('english');
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const nErr = validateName(name);
    if (nErr) {
      setFormError(nErr);
      return;
    }
    setFormError(null);
    setPollState('creating');
    try {
      const res = await api.createGame({ name: name.trim(), civ });
      setMembership(res.gameCode, {
        playerToken: res.playerToken,
        seat: res.seat,
        civ,
        name: name.trim(),
      });
      setCurrentGame(res.gameCode, res.state);
      setPollState('active');
      navigate({ name: 'lobby', gameCode: res.gameCode });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'unknown error';
      setPollState('error', msg);
    }
  };

  return (
    <form onSubmit={handleSubmit} aria-label="Create game" className="form">
      <label>
        Your name
        <input
          name="name"
          data-testid="create-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
        />
      </label>
      <label>
        Civilization
        <select
          name="civ"
          data-testid="create-civ"
          value={civ}
          onChange={(e) => setCiv(e.target.value as Civ)}
        >
          {CIV_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {formError && (
        <p role="alert" className="error">
          {formError}
        </p>
      )}
      {pollState === 'error' && storeError && (
        <p role="alert" className="error">
          {storeError}
        </p>
      )}
      <button type="submit" data-testid="create-submit" disabled={pollState === 'creating'}>
        {pollState === 'creating' ? 'Creating…' : 'Create game'}
      </button>
    </form>
  );
};

const JoinForm = (): JSX.Element => {
  const api = useGameApi();
  const setMembership = useSession((s) => s.setMembership);
  const setCurrentGame = useSession((s) => s.setCurrentGame);
  const setPollState = useSession((s) => s.setPollState);
  const pollState = useSession((s) => s.pollState);
  const storeError = useSession((s) => s.error);

  const [gameCode, setGameCode] = useState('');
  const [name, setName] = useState('');
  const [civ, setCiv] = useState<Civ>('byzantines');
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const codeErr = validateGameCode(gameCode);
    if (codeErr) {
      setFormError(codeErr);
      return;
    }
    const nErr = validateName(name);
    if (nErr) {
      setFormError(nErr);
      return;
    }
    setFormError(null);
    setPollState('joining');
    try {
      const code = gameCode.trim().toUpperCase();
      const res = await api.joinGame({ gameCode: code, name: name.trim(), civ });
      setMembership(res.gameCode, {
        playerToken: res.playerToken,
        seat: res.seat,
        civ,
        name: name.trim(),
      });
      setCurrentGame(res.gameCode, res.state);
      setPollState('active');
      navigate({ name: 'lobby', gameCode: res.gameCode });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'unknown error';
      setPollState('error', msg);
    }
  };

  return (
    <form onSubmit={handleSubmit} aria-label="Join game" className="form">
      <label>
        Game code
        <input
          name="gameCode"
          data-testid="join-code"
          value={gameCode}
          onChange={(e) => setGameCode(e.target.value.toUpperCase())}
          maxLength={6}
          placeholder="ABCD12"
          autoCapitalize="characters"
        />
      </label>
      <label>
        Your name
        <input
          name="name"
          data-testid="join-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
        />
      </label>
      <label>
        Civilization
        <select
          name="civ"
          data-testid="join-civ"
          value={civ}
          onChange={(e) => setCiv(e.target.value as Civ)}
        >
          {CIV_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {formError && (
        <p role="alert" className="error">
          {formError}
        </p>
      )}
      {pollState === 'error' && storeError && (
        <p role="alert" className="error">
          {storeError}
        </p>
      )}
      <button type="submit" data-testid="join-submit" disabled={pollState === 'joining'}>
        {pollState === 'joining' ? 'Joining…' : 'Join game'}
      </button>
    </form>
  );
};
