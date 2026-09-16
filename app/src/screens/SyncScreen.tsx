import React, {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, Text} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Button, Card, Label, Muted, Screen, Title, colors} from '../components/ui';
import {syncQueue} from '../db/repositories';
import type {SyncQueueRow} from '../domain/types';
import {useApp} from '../state/AppContext';

export function SyncScreen() {
  const {sync, syncNow, refreshSyncStatus, apiUrl} = useApp();
  const [pending, setPending] = useState<SyncQueueRow[]>([]);
  const [failed, setFailed] = useState<SyncQueueRow[]>([]);

  const load = useCallback(() => {
    setPending(syncQueue.pending());
    setFailed(syncQueue.failed());
    refreshSyncStatus();
  }, [refreshSyncStatus]);
  useFocusEffect(load);

  return (
    <Screen>
      <Title>Sync</Title>
      <Card>
        <Muted>
          Server {apiUrl} · {sync.online ? 'online' : 'offline'} · last successful sync {sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : 'never'}
        </Muted>
        <Muted>
          {sync.pendingCount} queued · {sync.pendingPhotos} photo files still on this iPad (deleted only after the server confirms each hash)
        </Muted>
        <Button title={sync.running ? 'Syncing…' : 'Sync now'} onPress={() => syncNow().then(load)} loading={sync.running} />
        {sync.lastError ? <Text style={styles.err}>{sync.lastError}</Text> : null}
      </Card>
      <ScrollView>
        <Label>Pending</Label>
        {pending.length === 0 ? <Muted>Nothing pending.</Muted> : null}
        {pending.map(r => (
          <Text key={r.id} style={styles.line}>
            {r.entity_type} · {r.entity_id.slice(0, 8)} · attempts {r.attempts}
            {r.last_error ? ` · ${r.last_error}` : ''}
          </Text>
        ))}
        {failed.length > 0 ? (
          <>
            <Label>Failed (needs attention)</Label>
            {failed.map(r => (
              <Text key={r.id} style={[styles.line, {color: colors.high}]}>
                {r.entity_type} · {r.entity_id.slice(0, 8)} · {r.last_error}
              </Text>
            ))}
            <Button
              title="Retry failed"
              kind="secondary"
              onPress={() => {
                syncQueue.retryFailed();
                load();
              }}
            />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: {fontSize: 14, color: colors.text, paddingVertical: 4},
  err: {color: colors.high, marginTop: 8},
});
