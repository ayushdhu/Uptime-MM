import React, {useEffect, useMemo, useState} from 'react';
import {Linking, View} from 'react-native';
import {useRoute, type RouteProp} from '@react-navigation/native';
import {WebView} from 'react-native-webview';
import RNFS from 'react-native-fs';
import {Button, Muted, Screen} from '../components/ui';
import {customers as customersRepo, highSeverityEvents as eventsRepo, inspections as inspectionsRepo, items as itemsRepo, machines as machinesRepo, signatures as signaturesRepo} from '../db/repositories';
import {buildReportHtml} from '../report/html';
import {templateItemsFor} from '../services/inspectionFlow';
import {useApp} from '../state/AppContext';
import type {RootStackParamList} from '../navigation/types';

/** Rendered on device from local data; the server PDF is the stored record. */
export function ReportScreen() {
  const {params} = useRoute<RouteProp<RootStackParamList, 'Report'>>();
  const {user, api} = useApp();
  const [ackImages, setAckImages] = useState<Record<string, string | null>>({});
  const inspection = inspectionsRepo.find(params.inspectionId);
  const signatures = useMemo(() => (inspection ? signaturesRepo.forInspection(inspection.client_generated_id) : []), [inspection]);

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

  if (!inspection) {
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
  return (
    <Screen style={{padding: 0}}>
      <WebView originWhitelist={['*']} source={{html}} style={{flex: 1}} />
      <View style={{padding: 12}}>
        <Muted>{inspection.synced_at ? 'Synced. The PDF on the server is the record.' : 'Not yet synced. This preview is rendered from the iPad.'}</Muted>
        {inspection.server_id ? <Button title="Open server PDF" kind="secondary" onPress={() => Linking.openURL(api.reportUrl(inspection.server_id!))} /> : null}
      </View>
    </Screen>
  );
}
