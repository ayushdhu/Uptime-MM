import React, {useCallback, useMemo, useState} from 'react';
import {Alert, Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Button, Card, Checkbox, Input, Label, Muted, Screen, Title, colors} from '../components/ui';
import {SignaturePad} from '../components/SignaturePad';
import {inspections as inspectionsRepo, photos as photosRepo} from '../db/repositories';
import type {ConversationChecklist, InspectionItem} from '../domain/types';
import {pendingHighItems, recordHighSeverityEvent, templateItemByKey} from '../services/inspectionFlow';
import {photoUri} from '../services/photos';
import {saveSignature} from '../services/signatures';
import {useApp} from '../state/AppContext';
import type {RootStackParamList} from '../navigation/types';

const STEPS: Array<{key: keyof ConversationChecklist; label: string}> = [
  {key: 'item_identified_and_shown', label: 'Item identified and shown to the owner'},
  {key: 'photo_shown', label: 'Photo shown to the owner'},
  {key: 'recommendation_stated', label: 'Recommendation stated: repair before further use'},
  {key: 'decision_recorded', label: 'Decision recorded below'},
];

/** A High finding is a conversation, not a notification (spec 6). One item at a time, all before checkout. */
export function HighSeverityFlowScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {params} = useRoute<RouteProp<RootStackParamList, 'HighSeverityFlow'>>();
  const {deviceId} = useApp();
  const inspection = inspectionsRepo.find(params.inspectionId)!;
  const templates = useMemo(() => templateItemByKey(inspection), [inspection]);
  const [pending, setPending] = useState<InspectionItem[]>([]);
  const [checklist, setChecklist] = useState<ConversationChecklist>({item_identified_and_shown: false, photo_shown: false, recommendation_stated: false, decision_recorded: false});
  const [outOfService, setOutOfService] = useState<boolean | null>(null);
  const [interval, setInterval_] = useState('');
  const [plan, setPlan] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('owner');
  const [initials, setInitials] = useState('');
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const list = pendingHighItems(params.inspectionId);
      setPending(list);
      if (list.length === 0) {
        nav.replace('Checkout', {inspectionId: params.inspectionId});
      }
    }, [params.inspectionId, nav]),
  );

  const item = pending[0];
  if (!item) {
    return <Screen />;
  }
  const template = templates.get(item.template_item_key);
  const photos = photosRepo.forItem(item.client_generated_id);
  const finding = item.result_type === 'pass_fail' ? `FAIL: ${template?.tier_criteria.high ?? ''}` : template?.tier_criteria.high ?? '';
  const allTicked = STEPS.every(s => checklist[s.key]);
  const decisionOk = outOfService === true || (outOfService === false && /^\d+$/.test(interval) && plan.trim().length > 0);

  const initialsOk = initials.trim().length >= 1 && initials.trim().length <= 6;
  const sign = async (png: string) => {
    if (!signerName.trim() || !initialsOk) {
      Alert.alert('Acknowledgment', 'Enter the signer name and have the owner type their initials before signing.');
      return;
    }
    setBusy(true);
    try {
      const sig = await saveSignature({
        inspectionId: inspection.client_generated_id,
        type: 'high_severity_ack',
        signerName,
        signerRole,
        signerStatement: statement,
        pngDataUrl: png,
        deviceId,
      });
      recordHighSeverityEvent({
        inspection,
        item,
        checklist: {...checklist, decision_recorded: true, owner_initials: initials.trim().toUpperCase()},
        outOfService: outOfService === true,
        recheckIntervalDays: outOfService ? null : parseInt(interval, 10),
        repairPlan: outOfService ? null : plan,
        ownerSignatureId: sig.client_generated_id,
      });
      const rest = pendingHighItems(params.inspectionId);
      setPending(rest);
      setChecklist({item_identified_and_shown: false, photo_shown: false, recommendation_stated: false, decision_recorded: false});
      setOutOfService(null);
      setInterval_('');
      setPlan('');
      setStatement('');
      setInitials('');
      if (rest.length === 0) {
        nav.replace('Checkout', {inspectionId: params.inspectionId});
      }
    } catch (e) {
      Alert.alert('Could not record', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Muted>High severity conversation · {pending.length} remaining</Muted>
        <Title>{item.component_name}</Title>
        <Card style={{borderColor: colors.high, borderWidth: 2}}>
          <Text style={styles.finding}>{finding}</Text>
          {item.technician_note ? <Muted>Technician note: {item.technician_note}</Muted> : null}
          <ScrollView horizontal style={{marginTop: 10}}>
            {photos.map(p => {
              const uri = photoUri(p);
              return uri ? <Image key={p.client_generated_id} source={{uri}} style={styles.photo} /> : null;
            })}
          </ScrollView>
        </Card>

        <Card>
          <Label>Conversation checklist</Label>
          {STEPS.slice(0, 3).map(s => (
            <Checkbox key={s.key} checked={Boolean(checklist[s.key])} label={s.label} onToggle={() => setChecklist(c => ({...c, [s.key]: !c[s.key]}))} />
          ))}
          <Label>Decision: machine out of service?</Label>
          <View style={styles.row}>
            <Button title="Yes, out of service" kind={outOfService === true ? 'danger' : 'secondary'} onPress={() => { setOutOfService(true); setChecklist(c => ({...c, decision_recorded: true})); }} style={{flex: 1}} />
            <Button title="No, stays in use" kind={outOfService === false ? 'primary' : 'secondary'} onPress={() => { setOutOfService(false); setChecklist(c => ({...c, decision_recorded: true})); }} style={{flex: 1}} />
          </View>
          {outOfService === false ? (
            <>
              <Label>Recheck interval agreed (days)</Label>
              <Input value={interval} onChangeText={setInterval_} keyboardType="number-pad" placeholder="e.g. 7" />
              <Label>Repair plan</Label>
              <Input value={plan} onChangeText={setPlan} multiline placeholder="Who fixes it and by when" style={{minHeight: 60}} />
            </>
          ) : null}
        </Card>

        <Card style={!(allTicked && decisionOk) ? {opacity: 0.4} : undefined} pointerEvents={allTicked && decisionOk ? 'auto' : 'none'}>
          <Label>Owner acknowledgment</Label>
          <Input value={signerName} onChangeText={setSignerName} placeholder="Signer name (typed by the signer)" />
          <View style={styles.row}>
            {['owner', 'foreman', 'designated representative'].map(r => (
              <Button key={r} title={r} kind={signerRole === r ? 'primary' : 'secondary'} onPress={() => setSignerRole(r)} style={{flex: 1}} />
            ))}
          </View>
          <Text style={styles.blurb}>
            By initialling and signing, the owner confirms they understand what was found and what Uptime recommended, and that
            deciding what to do about it is theirs to make.
          </Text>
          <Label>Owner initials (required)</Label>
          <Input value={initials} onChangeText={t => setInitials(t.slice(0, 6))} placeholder="e.g. JD" autoCapitalize="characters" maxLength={6} style={styles.initials} />
          <Label>Owner statement, in their own words (optional)</Label>
          <Input value={statement} onChangeText={setStatement} multiline placeholder="Only if the owner wants something recorded, e.g. why they are running it anyway" style={styles.statement} />
          {initialsOk && signerName.trim() ? <SignaturePad onCaptured={sign} /> : <Muted>Signature pad unlocks once the name and initials are entered.</Muted>}
          {busy ? <Muted>Saving…</Muted> : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  finding: {fontSize: 17, color: colors.text, fontWeight: '600'},
  photo: {width: 160, height: 160, borderRadius: 8, marginRight: 8, backgroundColor: '#ddd'},
  row: {flexDirection: 'row', gap: 10},
  blurb: {fontSize: 15, color: colors.text, marginTop: 4, marginBottom: 4},
  initials: {fontSize: 26, fontWeight: '700', letterSpacing: 4, maxWidth: 200},
  statement: {minHeight: 70},
});
