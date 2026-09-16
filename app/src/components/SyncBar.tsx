import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useApp} from '../state/AppContext';

/** Persistent sync status: pending count, last successful sync, manual "Sync now" (spec 7.7). */
export function SyncBar({onOpen}: {onOpen?: () => void}) {
  const {sync, syncNow} = useApp();
  const last = sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : 'never';
  const color = sync.lastError ? '#B3261E' : sync.pendingCount > 0 ? '#B26A00' : '#2E7D32';
  return (
    <View style={[styles.bar, {borderLeftColor: color}]}>
      <Pressable onPress={onOpen} style={{flex: 1}}>
        <Text style={styles.text}>
          {sync.online ? 'Online' : 'Offline'} · {sync.pendingCount} pending{sync.pendingPhotos ? ` (${sync.pendingPhotos} photos on device)` : ''} · last sync {last}
        </Text>
        {sync.lastError ? <Text style={styles.err}>{sync.lastError}</Text> : null}
        {sync.clockSkewSeconds > 600 ? <Text style={styles.err}>Device clock differs from server by {Math.round(sync.clockSkewSeconds / 60)} min</Text> : null}
      </Pressable>
      <Pressable accessibilityRole="button" disabled={sync.running} onPress={() => syncNow()} style={[styles.btn, sync.running && {opacity: 0.5}]}>
        <Text style={styles.btnText}>{sync.running ? 'Syncing…' : 'Sync now'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderLeftWidth: 6, padding: 10, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#D5D9E0'},
  text: {fontSize: 13, color: '#15171A'},
  err: {fontSize: 12, color: '#B3261E', marginTop: 2},
  btn: {backgroundColor: '#1D4ED8', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, marginLeft: 10},
  btnText: {color: '#fff', fontWeight: '600'},
});
