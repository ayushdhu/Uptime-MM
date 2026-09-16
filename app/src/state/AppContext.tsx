import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import NetInfo from '@react-native-community/netinfo';
import {ApiClient} from '../api/client';
import {getDb, getMeta, setMeta} from '../db/database';
import {syncQueue, photos as photosRepo} from '../db/repositories';
import type {User} from '../domain/types';
import {SyncEngine, nextRetryDelayMs, type SyncReport} from '../sync/engine';
import {nativeFileSystem} from '../services/files';
import {getDeviceId} from '../services/device';

export const DEFAULT_API_URL = 'http://localhost:3000';

export interface SyncStatus {
  pendingCount: number;
  pendingPhotos: number;
  lastSyncAt: string | null;
  running: boolean;
  online: boolean;
  /** Most recent persisted failure reason from the queue (survives restarts). */
  lastError: string | null;
  lastErrorAt: string | null;
  erroredCount: number;
  failedCount: number;
  nextRetryAt: string | null;
  clockSkewSeconds: number;
}

interface AppState {
  ready: boolean;
  user: User | null;
  deviceId: string;
  apiUrl: string;
  api: ApiClient;
  sync: SyncStatus;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  setApiUrl(url: string): void;
  syncNow(): Promise<SyncReport | null>;
  refreshSyncStatus(): void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({children}: {children: React.ReactNode}) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [apiUrl, setApiUrlState] = useState(DEFAULT_API_URL);
  const [sync, setSync] = useState<SyncStatus>({pendingCount: 0, pendingPhotos: 0, lastSyncAt: null, running: false, online: false, lastError: null, lastErrorAt: null, erroredCount: 0, failedCount: 0, nextRetryAt: null, clockSkewSeconds: 0});
  const apiRef = useRef(new ApiClient({baseUrl: DEFAULT_API_URL, token: null, deviceId: ''}));
  const engineRef = useRef<SyncEngine | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failedRuns = useRef(0);

  const refreshSyncStatus = useCallback(() => {
    const errors = syncQueue.errorSummary();
    setSync(s => ({
      ...s,
      pendingCount: syncQueue.pendingCount(),
      pendingPhotos: photosRepo.pendingLocalCount(),
      lastSyncAt: getMeta('last_sync_at'),
      lastError: errors.lastError,
      lastErrorAt: errors.lastAttemptAt,
      erroredCount: errors.erroredCount,
      failedCount: errors.failedCount,
      clockSkewSeconds: apiRef.current.clockSkewSeconds,
    }));
  }, []);

  useEffect(() => {
    (async () => {
      getDb();
      const id = await getDeviceId();
      const url = getMeta('api_url') ?? DEFAULT_API_URL;
      const token = getMeta('auth_token');
      const savedUser = getMeta('auth_user');
      apiRef.current = new ApiClient({baseUrl: url, token, deviceId: id});
      engineRef.current = new SyncEngine(apiRef.current, nativeFileSystem, msg => console.warn(msg));
      setDeviceId(id);
      setApiUrlState(url);
      if (token && savedUser) {
        setUser(JSON.parse(savedUser));
      }
      refreshSyncStatus();
      setReady(true);
    })();
    const unsub = NetInfo.addEventListener(state => {
      setSync(s => ({...s, online: Boolean(state.isConnected && state.isInternetReachable !== false)}));
    });
    return unsub;
  }, [refreshSyncStatus]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiRef.current.login(email, password, deviceId);
      apiRef.current.setToken(res.token);
      setMeta('auth_token', res.token);
      setMeta('auth_user', JSON.stringify(res.user));
      setUser(res.user);
    },
    [deviceId],
  );

  const logout = useCallback(async () => {
    try {
      await apiRef.current.logout();
    } catch {
      // offline logout is fine; the token is dropped locally
    }
    apiRef.current.setToken(null);
    setMeta('auth_token', null);
    setMeta('auth_user', null);
    setUser(null);
  }, []);

  const setApiUrl = useCallback(
    (url: string) => {
      const clean = url.trim().replace(/\/+$/, '');
      setMeta('api_url', clean);
      setApiUrlState(clean);
      apiRef.current = new ApiClient({baseUrl: clean, token: getMeta('auth_token'), deviceId});
      engineRef.current = new SyncEngine(apiRef.current, nativeFileSystem, msg => console.warn(msg));
    },
    [deviceId],
  );

  const syncNow = useCallback(async (): Promise<SyncReport | null> => {
    const engine = engineRef.current;
    if (!engine || engine.isRunning || !user) {
      return null;
    }
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    setSync(s => ({...s, running: true, nextRetryAt: null}));
    let report: SyncReport | null = null;
    let runError: string | null = null;
    try {
      report = await engine.run();
    } catch (e) {
      runError = (e as Error).message;
    }
    setSync(s => ({...s, running: false}));
    refreshSyncStatus();
    // The queue retries on its own: back off after failures, keep going while work is pending.
    const stillPending = syncQueue.pendingCount() > 0;
    const hadFailure = runError !== null || (report?.failed ?? 0) > 0;
    failedRuns.current = hadFailure ? failedRuns.current + 1 : 0;
    if (stillPending) {
      const delay = hadFailure ? nextRetryDelayMs(failedRuns.current) : 5_000;
      setSync(s => ({...s, nextRetryAt: new Date(Date.now() + delay).toISOString(), lastError: runError ?? s.lastError}));
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        syncNow();
      }, delay);
    }
    return report;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, refreshSyncStatus]);

  // Auto sync when we come online with work pending.
  useEffect(() => {
    if (ready && user && sync.online && !sync.running && sync.pendingCount > 0) {
      syncNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.online, ready, user]);

  const value = useMemo<AppState>(
    () => ({ready, user, deviceId, apiUrl, api: apiRef.current, sync, login, logout, setApiUrl, syncNow, refreshSyncStatus}),
    [ready, user, deviceId, apiUrl, sync, login, logout, setApiUrl, syncNow, refreshSyncStatus],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error('useApp outside AppProvider');
  }
  return v;
}
