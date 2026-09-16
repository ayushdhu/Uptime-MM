import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useRoute, type RouteProp} from '@react-navigation/native';
import {WebView} from 'react-native-webview';
import RNFS from 'react-native-fs';
import {Button, Card, Muted, Screen, colors} from '../components/ui';
import {customers as customersRepo, highSeverityEvents as eventsRepo, inspections as inspectionsRepo, items as itemsRepo, machines as machinesRepo, signatures as signaturesRepo} from '../db/repositories';
import {buildReportHtml} from '../report/html';
import {templateItemsFor} from '../services/inspectionFlow';
import {inspectionSyncState, type InspectionSyncState} from '../services/syncStatus';
import {downloadServerReport, type ReportDownload} from '../services/reportDownload';
import {useApp} from '../state/AppContext';
import type {RootStackParamList} from '../navigation/types';
import {ServerPdfView} from '../components/ServerPdfView';

/**
 * Two different things, labelled as such: the on-device report rendered from
 * local data (available offline, before and after lock), and the server PDF,
 * which exists only once the server has accepted the lock.
 */
export function ReportScreen() {
  const {params} = useRoute<RouteProp<RootStackParamList, 'Report'>>();
  const {user, api, sync, syncNow} = useApp();
  const [mode, setMode] = useState<'device' | 'server'>('device');
  const [ackImages, setAckImages] = useState<Record<string, string | null>>({});
  const [state, setState] = useState<InspectionSyncState | null>(null);
  const [download, setDownload] = useState<ReportDownload | null>(null);
  const inspection = inspectionsRepo.find(params.inspectionId);
  const signatures = useMemo(() => (inspection ? signaturesRepo.forInspection(inspection.client_generated_id) : []), [inspection]);

  const refreshState = useCallback(() => setState(inspectionSyncState(params.inspectionId)), [params.inspectionId]);
  useFocusEffect(refreshState);
  // Re-read after every sync pass so the banner flips to "recorded" without leaving the screen.
  useEffect(refreshState, [refreshState, sync.pendingCount, sync.running]);

  useEffect(() => {
    (async () => {
      const out: Record<string, string | null> = {};
      for (const s of signatures) {
        if (s.signature_type === 'high_severity_ack' && s.local_path && (await RNFS.exists(s.local_path))) {
          out[s.client_generated_id] = `data:image/png;base64,${await RNFS.readFile(s.local_path, 'base64')}`;
        }
      }
      setAckImages(out);
    })();
  }, [signatures]);

  if (!inspection || !state) {
    return <Screen />;
  }
  const machine = machinesRepo.find(inspection.machine_id)!;
  const html = buildReportHtml({
    inspection,
    machine,
    customer: customersRepo.find(inspection.customer_id),
    technicianName: user?.name ?? inspection.technician_id,
    items: itemsRepo.forInspection(inspection.client_generated_id),
    templateItems: templateItemsFor(inspection),
    signatures,
    events: eventsRepo.forInspection(inspection.client_generated_id),
    ackImages,
  });

  const openServerPdf = async () => {
    setMode('server');
    if (!inspection.server_id) {
      return;
    }
    setDownload({status: 'downloading'});
    setDownload(await downloadServerReport(api, inspection.client_generated_id, inspection.server_id, state.serverReportSha256));
  };

  return (
    <Screen style={styles.screen}>
      <Card style={[styles.status, state.lockedOnServer ? styles.ok : state.lockedLocally ? styles.warn : styles.info]}>
        {!state.lockedLocally ? (
          <Text style={styles.statusTitle}>Not locked. This is a preview from the tablet; there is no report yet.</Text>
        ) : state.lockedOnServer ? (
          <Text style={styles.statusTitle}>Recorded. Locked on the server on {state ? (inspection.server_locked_at ?? '').slice(0, 16).replace('T', ' ') : ''}.</Text>
        ) : (
          <>
            <Text style={styles.statusTitle}>Locked on this tablet only. NOT yet recorded on the server.</Text>
            {state.outstanding.map(o => (
              <Text key={o} style={styles.line}>• {o}</Text>
            ))}
            {state.errors.length > 0 ? <Text style={styles.err}>Last error: {state.errors[state.errors.length - 1].last_error}</Text> : null}
            <Button title={sync.running ? 'Syncing…' : 'Sync now'} kind="secondary" onPress={() => syncNow()} loading={sync.running} />
          </>
        )}
      </Card>
      <View style={styles.tabs}>
        <Button title="On-device report" kind={mode === 'device' ? 'primary' : 'secondary'} onPress={() => setMode('device')} style={styles.tab} />
        <Button
          title={state.lockedOnServer ? 'Server PDF (the record)' : 'Server PDF (not yet available)'}
          kind={mode === 'server' ? 'primary' : 'secondary'}
          disabled={!state.lockedOnServer}
          onPress={openServerPdf}
          style={styles.tab}
        />
      </View>
      {mode === 'device' ? (
        <WebView originWhitelist={['*']} source={{html}} style={styles.web} />
      ) : (
        <ServerPdfView download={download} onRetry={openServerPdf} />
      )}
      <Muted>
        {mode === 'device'
          ? 'Rendered on this tablet from local data. Photos are never in the report.'
          : 'Fetched from the server with your login and verified against the stored SHA-256.'}
      </Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {padding: 12},
  status: {marginBottom: 8},
  ok: {borderColor: colors.low, borderWidth: 2},
  warn: {borderColor: colors.high, borderWidth: 2},
  info: {borderColor: colors.medium, borderWidth: 2},
  statusTitle: {fontSize: 16, fontWeight: '700', color: colors.text},
  line: {fontSize: 14, color: colors.text, marginTop: 2},
  err: {fontSize: 13, color: colors.high, marginTop: 4},
  tabs: {flexDirection: 'row', gap: 8, marginBottom: 6},
  tab: {flex: 1, marginTop: 0},
  web: {flex: 1, backgroundColor: '#fff'},
});
