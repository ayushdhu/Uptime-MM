import React, {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Button, Card, Label, Muted, Screen, Title, colors} from '../components/ui';
import {highSeverityEvents as eventsRepo, inspections as inspectionsRepo, items as itemsRepo, machines as machinesRepo, photos as photosRepo, signatures as signaturesRepo, syncQueue} from '../db/repositories';
import type {SyncQueueRow} from '../domain/types';
import {useApp} from '../state/AppContext';

function describeRow(r: SyncQueueRow): string {
  const insp = inspectionsRepo.find(r.inspection_id);
  const machine = insp && machinesRepo.find(insp.machine_id);
  const where = machine ? `${machine.serial_number} · ${insp!.performed_at.slice(0, 10)}` : r.inspection_id.slice(0, 8);
  switch (r.entity_type) {
    case 'photo': {
      const p = photosRepo.find(r.entity_id);
      const item = p && itemsRepo.find(p.inspection_item_id);
      return `Photo of ${item?.component_name ?? 'item'} — ${where}`;
    }
    case 'signature': {
      const s = signaturesRepo.find(r.entity_id);
      return `${s?.signature_type === 'high_severity_ack' ? 'High acknowledgment' : 'Checkout'} signature — ${where}`;
    }
    case 'high_severity_event':
      return `High severity event (${eventsRepo.find(r.entity_id)?.component_name ?? 'item'}) — ${where}`;
    case 'lock':
      return `Lock inspection — ${where}`;
    case 'inspection':
      return `Inspection — ${where}`;
    case 'inspection_item':
      return `Checklist items — ${where}`;
    case 'note':
      return `Note — ${where}`;
  }
}

/** Every unfinished queue row with its state, attempt count and last failure reason. Nothing fails silently. */
export function SyncScreen() {
  const {sync, syncNow, refreshSyncStatus, apiUrl} = useApp();
  const [rows, setRows] = useState<SyncQueueRow[]>([]);

  const load = useCallback(() => {
    setRows(syncQueue.unfinished());
    refreshSyncStatus();
  }, [refreshSyncStatus]);
  useFocusEffect(load);

  const retryOne = (r: SyncQueueRow) => {
    syncQueue.retryRow(r.id);
    load();
    syncNow().then(load);
  };

  return (
    <Screen>
      <Title>Sync</Title>
      <Card>
        <Muted>
          Server {apiUrl} · {sync.online ? 'online' : 'offline'} · last successful sync {sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : 'never'}
        </Muted>
        <Muted>
          {sync.pendingCount} queued · {sync.pendingPhotos} photo files still on this tablet (deleted only after the server confirms each hash)
          {sync.nextRetryAt ? ` · next automatic retry ${new Date(sync.nextRetryAt).toLocaleTimeString()}` : ''}
        </Muted>
        <Button title={sync.running ? 'Syncing…' : 'Sync now'} onPress={() => syncNow().then(load)} loading={sync.running} />
        {sync.failedCount > 0 ? (
          <Button
            title={`Retry ${sync.failedCount} failed item${sync.failedCount === 1 ? '' : 's'}`}
            kind="secondary"
            onPress={() => {
              syncQueue.retryFailed();
              load();
              syncNow().then(load);
            }}
          />
        ) : null}
      </Card>
      <ScrollView>
        <Label>Queue</Label>
        {rows.length === 0 ? <Muted>Nothing pending. Everything on this tablet is on the server.</Muted> : null}
        {rows.map(r => (
          <Card key={r.id} style={[styles.row, r.status === 'failed' ? styles.failed : r.last_error ? styles.errored : null]}>
            <View style={styles.head}>
              <Text style={styles.what}>{describeRow(r)}</Text>
              <Text style={[styles.state, r.status === 'failed' ? styles.stateFailed : r.last_error ? styles.stateErr : styles.statePending]}>
                {r.status === 'failed' ? 'NEEDS ATTENTION' : r.last_error ? 'RETRYING' : 'WAITING'}
              </Text>
            </View>
            <Muted>
              {r.attempts} attempt{r.attempts === 1 ? '' : 's'}
              {r.last_attempt_at ? ` · last tried ${new Date(r.last_attempt_at).toLocaleTimeString()}` : ''}
            </Muted>
            {r.last_error ? <Text style={styles.reason}>{r.last_error}</Text> : null}
            {r.last_error ? <Button title="Retry now" kind="secondary" onPress={() => retryOne(r)} /> : null}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {paddingVertical: 10},
  errored: {borderColor: colors.medium, borderWidth: 2},
  failed: {borderColor: colors.high, borderWidth: 2},
  head: {flexDirection: 'row', justifyContent: 'space-between', gap: 8},
  what: {fontSize: 15, fontWeight: '600', color: colors.text, flex: 1},
  state: {fontWeight: '800', fontSize: 12},
  statePending: {color: colors.muted},
  stateErr: {color: colors.medium},
  stateFailed: {color: colors.high},
  reason: {color: colors.high, marginTop: 4, fontSize: 14},
});
