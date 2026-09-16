import React, {useCallback, useState} from 'react';
import {Alert, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Button, Card, Input, Label, Muted, Screen, Title, colors} from '../components/ui';
import {highSeverityEvents as eventsRepo, inspections as inspectionsRepo, items as itemsRepo, notes as notesRepo} from '../db/repositories';
import type {HighSeverityEvent, Inspection, InspectionItem, InspectionNote} from '../domain/types';
import {appendNote} from '../services/inspectionFlow';
import {useApp} from '../state/AppContext';
import type {RootStackParamList} from '../navigation/types';

/** Read only view of a completed/locked inspection. The only write is an appended note. */
export function InspectionDetailScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {params} = useRoute<RouteProp<RootStackParamList, 'InspectionDetail'>>();
  const {user, api, sync, syncNow} = useApp();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [notes, setNotes] = useState<InspectionNote[]>([]);
  const [events, setEvents] = useState<HighSeverityEvent[]>([]);
  const [body, setBody] = useState('');
  const [resolveNote, setResolveNote] = useState('');

  const load = useCallback(() => {
    setInspection(inspectionsRepo.find(params.inspectionId));
    setItems(itemsRepo.forInspection(params.inspectionId));
    setNotes(notesRepo.forInspection(params.inspectionId));
    setEvents(eventsRepo.forInspection(params.inspectionId));
  }, [params.inspectionId]);
  useFocusEffect(load);

  if (!inspection || !user) {
    return <Screen />;
  }
  const senior = user.role === 'senior_technician' || user.role === 'admin';

  const addNote = () => {
    try {
      appendNote(inspection, user, body, null);
      setBody('');
      load();
      if (sync.online) {
        syncNow();
      }
    } catch (e) {
      Alert.alert('Note', (e as Error).message);
    }
  };

  const resolve = async (ev: HighSeverityEvent) => {
    if (!ev.server_id || !inspection.server_id) {
      Alert.alert('Sync first', 'Resolving needs the event and this inspection to be on the server.');
      return;
    }
    if (!resolveNote.trim()) {
      Alert.alert('Resolution note', 'Type how it was resolved.');
      return;
    }
    try {
      await api.resolveHighSeverityEvent(ev.server_id, inspection.server_id, resolveNote.trim());
      eventsRepo.resolveLocally(ev.client_generated_id, new Date().toISOString(), resolveNote.trim());
      setResolveNote('');
      load();
    } catch (e) {
      Alert.alert('Could not resolve', (e as Error).message);
    }
  };

  const rechecked = items.filter(i => i.carried_forward_from_item_id);
  const openOnMachine = eventsRepo.openForMachine(inspection.machine_id);

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Title>{inspection.performed_at.slice(0, 16).replace('T', ' ')}</Title>
        <Muted>
          {inspection.inspection_type} · {inspection.status.toUpperCase()} · hour meter {inspection.hour_meter_reading} · checklist {inspection.checklist_version}
          {inspection.locked_at ? ` · locked ${inspection.locked_at.slice(0, 16).replace('T', ' ')}` : ''} · {inspection.synced_at ? 'synced' : 'not synced'}
        </Muted>
        {inspection.status === 'locked' ? <Text style={styles.locked}>Locked. Results cannot be edited. Add a note below.</Text> : null}
        <Button title="View report" kind="secondary" onPress={() => nav.navigate('Report', {inspectionId: inspection.client_generated_id})} />

        <Label>Items</Label>
        {items.map(i => (
          <Card key={i.client_generated_id} style={{paddingVertical: 10}}>
            <View style={styles.row}>
              <Text style={styles.item}>{i.component_name}</Text>
              <Text style={[styles.result, {color: i.skipped ? colors.muted : i.severity ? colors[i.severity] : i.pass === false ? colors.fail : colors.pass}]}>
                {i.skipped ? 'SKIPPED' : i.severity ? i.severity.toUpperCase() : i.pass === null ? '' : i.pass ? 'PASS' : 'FAIL'}
                {i.measurement_value !== null ? ` · ${i.measurement_value} ${i.measurement_unit ?? ''}` : ''}
              </Text>
            </View>
            {i.technician_note ? <Muted>{i.technician_note}</Muted> : null}
            {i.skip_reason ? <Muted>Skipped: {i.skip_reason}</Muted> : null}
          </Card>
        ))}

        {senior && rechecked.length > 0 && openOnMachine.length > 0 ? (
          <Card style={{borderColor: colors.high}}>
            <Label>Resolve open High items rechecked on this visit</Label>
            <Input value={resolveNote} onChangeText={setResolveNote} placeholder="Resolution note" />
            {openOnMachine
              .filter(ev => rechecked.some(r => r.carried_forward_from_item_id === ev.inspection_item_id))
              .map(ev => (
                <Button key={ev.client_generated_id} title={`Mark resolved: ${ev.component_name}`} kind="danger" onPress={() => resolve(ev)} />
              ))}
          </Card>
        ) : null}

        {events.length > 0 ? (
          <Card>
            <Label>High severity events opened on this visit</Label>
            {events.map(e => (
              <Text key={e.client_generated_id} style={styles.item}>
                • {e.component_name}: {e.machine_out_of_service ? 'out of service' : `recheck in ${e.recheck_interval_days} days, ${e.repair_plan}`}
                {e.resolved_at ? ` (resolved ${e.resolved_at.slice(0, 10)})` : ' (open)'}
              </Text>
            ))}
          </Card>
        ) : null}

        <Card>
          <Label>Notes (append only)</Label>
          {notes.map(n => (
            <View key={n.client_generated_id} style={styles.note}>
              <Muted>
                {n.author_name} ({n.author_role}) · {n.created_at.slice(0, 16).replace('T', ' ')} · {n.synced_at ? 'synced' : 'pending'}
              </Muted>
              <Text style={styles.item}>{n.body}</Text>
            </View>
          ))}
          <Input value={body} onChangeText={setBody} multiline placeholder="Add a note. It cannot be edited or deleted afterwards." style={{minHeight: 60}} />
          <Button title="Append note" onPress={addNote} disabled={!body.trim()} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  locked: {color: colors.high, fontWeight: '700', marginVertical: 8},
  row: {flexDirection: 'row', justifyContent: 'space-between', gap: 10},
  item: {fontSize: 15, color: colors.text, flex: 1},
  result: {fontWeight: '800'},
  note: {borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 8},
});
