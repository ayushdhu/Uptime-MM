import React, {useCallback, useState} from 'react';
import {Alert, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Button, Card, Input, Label, Muted, Screen, Title, colors} from '../components/ui';
import {SignaturePad} from '../components/SignaturePad';
import {highSeverityEvents as eventsRepo, inspections as inspectionsRepo, items as itemsRepo, signatures as signaturesRepo} from '../db/repositories';
import {highItems, tierCounts} from '../domain/checklist';
import type {Inspection, InspectionItem} from '../domain/types';
import {checkoutErrors, lockInspection} from '../services/inspectionFlow';
import {saveSignature} from '../services/signatures';
import {useApp} from '../state/AppContext';
import type {RootStackParamList} from '../navigation/types';

/** Summary, signer details and statement, signature, lock (spec 5.4). */
export function CheckoutScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {params} = useRoute<RouteProp<RootStackParamList, 'Checkout'>>();
  const {deviceId, syncNow, sync} = useApp();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('owner');
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setInspection(inspectionsRepo.find(params.inspectionId));
      setItems(itemsRepo.forInspection(params.inspectionId));
    }, [params.inspectionId]),
  );

  if (!inspection) {
    return <Screen />;
  }
  const counts = tierCounts(items);
  const highs = highItems(items);
  const carried = items.filter(i => i.carried_forward_from_item_id);
  const events = eventsRepo.forInspection(inspection.client_generated_id);
  const hasCheckout = signaturesRepo.forInspection(inspection.client_generated_id).some(s => s.signature_type === 'visit_checkout');
  const errors = checkoutErrors(inspection).filter(e => !e.startsWith('Visit checkout'));

  const sign = async (png: string) => {
    if (!signerName.trim() || !statement.trim()) {
      Alert.alert('Signer', 'Enter the signer name and their statement in their own words.');
      return;
    }
    setBusy(true);
    try {
      await saveSignature({inspectionId: inspection.client_generated_id, type: 'visit_checkout', signerName, signerRole, signerStatement: statement, pngDataUrl: png, deviceId});
      const locked = lockInspection(inspection);
      setInspection(locked);
      if (sync.online) {
        syncNow();
      }
      nav.replace('Report', {inspectionId: locked.client_generated_id});
    } catch (e) {
      Alert.alert('Cannot lock', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Title>Checkout</Title>
        <Card>
          <View style={styles.counts}>
            {(['high', 'medium', 'low'] as const).map(t => (
              <View key={t} style={[styles.count, {borderColor: colors[t]}]}>
                <Text style={[styles.countN, {color: colors[t]}]}>{counts[t]}</Text>
                <Text style={styles.countL}>{t.toUpperCase()}</Text>
              </View>
            ))}
            <View style={[styles.count, {borderColor: colors.border}]}>
              <Text style={styles.countN}>{counts.pass}/{counts.pass + counts.fail}</Text>
              <Text style={styles.countL}>PASS</Text>
            </View>
            <View style={[styles.count, {borderColor: colors.border}]}>
              <Text style={styles.countN}>{counts.skipped}</Text>
              <Text style={styles.countL}>SKIPPED</Text>
            </View>
          </View>
        </Card>
        {highs.length > 0 && (
          <Card style={{borderColor: colors.high}}>
            <Label>High items</Label>
            {highs.map(i => (
              <Text key={i.client_generated_id} style={styles.line}>
                • {i.component_name} — {events.some(e => e.inspection_item_id === i.client_generated_id) ? 'acknowledged and signed' : 'NOT YET ACKNOWLEDGED'}
              </Text>
            ))}
          </Card>
        )}
        {carried.length > 0 && (
          <Card>
            <Label>Carried forward rechecks</Label>
            {carried.map(i => (
              <Text key={i.client_generated_id} style={styles.line}>
                • {i.component_name.replace('RECHECK: ', '')} — {i.done ? (i.skipped ? `skipped: ${i.skip_reason}` : `rechecked ${i.severity?.toUpperCase()}`) : 'not rechecked'}
              </Text>
            ))}
            <Muted>Marking an open High item resolved is done by a senior technician on the machine screen after this visit syncs.</Muted>
          </Card>
        )}
        {errors.length > 0 ? (
          <Card style={{borderColor: colors.high}}>
            <Label>Cannot lock yet</Label>
            {errors.map(e => (
              <Text key={e} style={styles.line}>• {e}</Text>
            ))}
            <Button title="Back to walkthrough" kind="secondary" onPress={() => nav.replace('Walkthrough', {inspectionId: inspection.client_generated_id})} />
          </Card>
        ) : (
          <Card>
            <Label>Signer</Label>
            <Input value={signerName} onChangeText={setSignerName} placeholder="Name (typed by the signer)" />
            <View style={styles.row}>
              {['owner', 'foreman', 'designated representative'].map(r => (
                <Button key={r} title={r} kind={signerRole === r ? 'primary' : 'secondary'} onPress={() => setSignerRole(r)} style={{flex: 1}} />
              ))}
            </View>
            <Label>Statement, in their own words</Label>
            <Input value={statement} onChangeText={setStatement} multiline style={{minHeight: 70}} />
            {hasCheckout ? <Muted>Already signed.</Muted> : <SignaturePad onCaptured={sign} />}
            <Muted>Signing locks the inspection permanently. Anything added later is a note.</Muted>
            {busy ? <Muted>Locking…</Muted> : null}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  counts: {flexDirection: 'row', gap: 10},
  count: {flex: 1, borderWidth: 2, borderRadius: 10, padding: 10, alignItems: 'center'},
  countN: {fontSize: 28, fontWeight: '800', color: colors.text},
  countL: {fontSize: 12, color: colors.muted, fontWeight: '700'},
  line: {fontSize: 15, color: colors.text, marginTop: 4},
  row: {flexDirection: 'row', gap: 10},
});
