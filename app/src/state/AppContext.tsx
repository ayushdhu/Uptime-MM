import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import NetInfo from '@react-native-community/netinfo';
import {ApiClient} from '../api/client';
import {getDb, getMeta, setMeta} from '../db/database';
import {syncQueue, photos as photosRepo} from '../db/repositories';
import type {User} from '../domain/types';
import {SyncEngine, type SyncReport} from '../sync/engine';
import {nativeFileSystem} from '../services/files';
import {getDeviceId} from '../services/device';

export const DEFAULT_API_URL = 'http://localhost:3000';

export interface SyncStatus {
  pendingCount: number;
  pendingPhotos: number;
  lastSyncAt: string | null;
  running: boolean;
  online: boolean;
  lastError: string | null;
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
  const [sync, setSync] = useState<SyncStatus>({pendingCount: 0, pendingPhotos: 0, lastSyncAt: null, running: false, online: false, lastError: null, clockSkewSeconds: 0});
  const apiRef = useRef(new ApiClient({baseUrl: DEFAULT_API_URL, token: null, deviceId: ''}));
  const engineRef = useRef<SyncEngine | null>(null);

  const refreshSyncStatus = useCallback(() => {
    setSync(s => ({
      ...s,
      pendingCount: syncQueue.pendingCount(),
      pendingPhotos: photosRepo.pendingLocalCount(),
      lastSyncAt: getMeta('last_sync_at'),
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

  const syncNow = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || engine.isRunning || !user) {
      return null;
    }
    setSync(s => ({...s, running: true, lastError: null}));
    try {
      const report = await engine.run();
      setSync(s => ({...s, lastError: report.errors[0] ?? null}));
      return report;
    } catch (e) {
      setSync(s => ({...s, lastError: (e as Error).message}));
      return null;
    } finally {
      setSync(s => ({...s, running: false}));
      refreshSyncStatus();
    }
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
