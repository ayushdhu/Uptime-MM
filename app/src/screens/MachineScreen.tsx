import React, {useCallback, useState} from 'react';
import {Alert, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Button, Card, Input, Label, Muted, Screen, Title, colors} from '../components/ui';
import {customers as customersRepo, highSeverityEvents as eventsRepo, inspections as inspectionsRepo, machines as machinesRepo} from '../db/repositories';
import type {HighSeverityEvent, Inspection, Machine} from '../domain/types';
import {startInspection} from '../services/inspectionFlow';
import {checkFreeSpace} from '../services/storageGuard';
import {useApp} from '../state/AppContext';
import type {RootStackParamList} from '../navigation/types';

export function MachineScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {params} = useRoute<RouteProp<RootStackParamList, 'Machine'>>();
  const {user, deviceId, api, sync} = useApp();
  const [machine, setMachine] = useState<Machine | null>(null);
  const [history, setHistory] = useState<Inspection[]>([]);
  const [openEvents, setOpenEvents] = useState<HighSeverityEvent[]>([]);
  const [hourMeter, setHourMeter] = useState('');
  const [starting, setStarting] = useState(false);

  const load = useCallback(() => {
    const m = machinesRepo.find(params.machineId);
    setMachine(m);
    setHistory(inspectionsRepo.forMachine(params.machineId));
    setOpenEvents(eventsRepo.openForMachine(params.machineId));
    if (m && !hourMeter) {
      setHourMeter(String(m.current_hour_meter ?? ''));
    }
  }, [params.machineId, hourMeter]);

  useFocusEffect(
    useCallback(() => {
      load();
      if (sync.online) {
        api
          .machineHistory(params.machineId)
          .then(res => {
            machinesRepo.upsert(res.data.machine);
            res.data.open_high_severity_events.forEach(e =>
              eventsRepo.upsert({
                client_generated_id: e.client_generated_id,
                server_id: e.id,
                inspection_item_id: e.inspection_item_id,
                inspection_id: e.inspection_id,
                machine_id: e.machine_id,
                component_name: e.component_name,
                template_item_key: e.template_item_key,
                opened_at: e.opened_at,
                conversation_checklist: e.conversation_checklist,
                machine_out_of_service: e.machine_out_of_service,
                recheck_interval_days: e.recheck_interval_days,
                repair_plan: e.repair_plan,
                owner_signature_id: e.owner_signature_id,
                resolved_at: e.resolved_at,
                resolution_note: e.resolution_note,
                photo_urls: e.photos.map(p => p.url),
              }),
            );
            load();
          })
          .catch(() => undefined);
      }
    }, [load, api, params.machineId, sync.online]),
  );

  const start = async () => {
    if (!machine || !user) {
      return;
    }
    const inProgress = inspectionsRepo.inProgressForMachine(machine.id);
    if (inProgress) {
      nav.navigate('Walkthrough', {inspectionId: inProgress.client_generated_id});
      return;
    }
    if (!/^\d+$/.test(hourMeter)) {
      Alert.alert('Hour meter', 'Enter the current hour meter reading before starting.');
      return;
    }
    setStarting(true);
    try {
      const space = await checkFreeSpace();
      if (space.level === 'block') {
        Alert.alert('Not enough storage', space.message);
        return;
      }
      if (space.level === 'warn') {
        Alert.alert('Storage low', space.message);
      }
      const inspection = startInspection({
        machineId: machine.id,
        technician: user,
        deviceId,
        hourMeter: parseInt(hourMeter, 10),
        type: history.length === 0 ? 'baseline' : 'walkthrough',
      });
      nav.navigate('Walkthrough', {inspectionId: inspection.client_generated_id});
    } catch (e) {
      Alert.alert('Cannot start', (e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  if (!machine) {
    return (
      <Screen>
        <Muted>Machine not on this device. Sync first.</Muted>
      </Screen>
    );
  }
  const inProgress = inspectionsRepo.inProgressForMachine(machine.id);

  return (
    <Screen>
      <Title>{machine.serial_number}</Title>
      <Muted>
        {machine.make} {machine.model} {machine.year} · {machine.machine_class.replace('_', ' ')} · {machine.drive_type} · {machine.emissions_tier === 'tier_4' ? 'Tier 4' : 'Tier 3'}
        {'\n'}
        {customersRepo.find(machine.customer_id)?.name} · Unique ID {machine.id}
        {'\n'}Checklist {machine.checklist_version} · hour meter {machine.current_hour_meter ?? '?'} · tag {machine.nfc_tag_id ?? 'none'}
      </Muted>

      {openEvents.length > 0 && (
        <Card style={{borderColor: colors.high}}>
          <Text style={[styles.h, {color: colors.high}]}>{openEvents.length} open High item(s): mandatory recheck on the next walkthrough</Text>
          {openEvents.map(e => (
            <Text key={e.client_generated_id} style={styles.line}>
              • {e.component_name} — {e.machine_out_of_service ? 'out of service' : `recheck every ${e.recheck_interval_days} days`} — opened {e.opened_at.slice(0, 10)}
            </Text>
          ))}
        </Card>
      )}

      <Card>
        <Label>Hour meter now</Label>
        <Input value={hourMeter} onChangeText={setHourMeter} keyboardType="number-pad" editable={!inProgress} />
        <Button title={inProgress ? 'Resume walkthrough' : history.length === 0 ? 'Start baseline walkthrough' : 'Start walkthrough'} onPress={start} loading={starting} />
        <Button title="Browse photos" kind="secondary" onPress={() => nav.navigate('PhotoBrowser', {machineId: machine.id})} />
      </Card>

      <Label>History on this device</Label>
      <FlatList
        data={history}
        keyExtractor={i => i.client_generated_id}
        ListEmptyComponent={<Muted>No inspections stored on this device.</Muted>}
        renderItem={({item}) => (
          <Pressable onPress={() => nav.navigate(item.status === 'in_progress' ? 'Walkthrough' : 'InspectionDetail', {inspectionId: item.client_generated_id})}>
            <Card>
              <View style={styles.row}>
                <Text style={styles.h}>
                  {item.performed_at.slice(0, 16).replace('T', ' ')} · {item.inspection_type}
                </Text>
                <Text style={{color: item.status === 'locked' ? colors.low : colors.medium, fontWeight: '700'}}>{item.status.toUpperCase()}</Text>
              </View>
              <Muted>
                hour meter {item.hour_meter_reading} · checklist {item.checklist_version} · {item.synced_at ? 'synced' : 'not synced'}
              </Muted>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  h: {fontSize: 16, fontWeight: '700', color: colors.text},
  line: {fontSize: 15, color: colors.text, marginTop: 4},
  row: {flexDirection: 'row', justifyContent: 'space-between'},
});
