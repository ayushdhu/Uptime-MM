import React, {useMemo, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Button, Card, Input, Label, Muted, Screen, Title, colors} from '../components/ui';
import {customers as customersRepo, machines as machinesRepo, templates as templatesRepo} from '../db/repositories';
import {deriveEmissionsTier, selectTemplate} from '../domain/checklist';
import type {DriveType, MachineClass} from '../domain/types';
import {writeMachineId} from '../services/nfc';
import {startInspection} from '../services/inspectionFlow';
import {useApp} from '../state/AppContext';
import type {RootStackParamList} from '../navigation/types';

const CLASSES: Array<{v: MachineClass; label: string}> = [
  {v: 'skid_steer', label: 'Skid Steer'},
  {v: 'wheel_loader', label: 'Loader'},
  {v: 'excavator', label: 'Excavator'},
  {v: 'farm_tractor', label: 'Tractor'},
  {v: 'dozer', label: 'Dozer'},
];

const STEPS = ['Machine type', 'Wheeled or tracked', 'DEF cap', 'Year', 'Make, model, serial', 'Hour meter', 'Hours per week', 'Customer', 'NFC tag', 'Template'];

/** Fixed order setup wizard (spec 5.2). Creating the machine needs a connection; the baseline walkthrough starts immediately after. */
export function SetupWizardScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {params} = useRoute<RouteProp<RootStackParamList, 'SetupWizard'>>();
  const {api, user, deviceId, sync} = useApp();
  const [step, setStep] = useState(0);
  const [machineClass, setMachineClass] = useState<MachineClass | null>(null);
  const [driveType, setDriveType] = useState<DriveType | null>(null);
  const [hasDef, setHasDef] = useState<boolean | null>(null);
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [hourMeter, setHourMeter] = useState('');
  const [hoursPerWeek, setHoursPerWeek] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [tagId, setTagId] = useState<string | null>(params.tagId ?? null);
  const [busy, setBusy] = useState(false);
  const customers = useMemo(() => customersRepo.all(), []);

  const template = useMemo(
    () => (machineClass && driveType && hasDef !== null ? selectTemplate(templatesRepo.all(), {machine_class: machineClass, drive_type: driveType, has_def: hasDef}) : null),
    [machineClass, driveType, hasDef],
  );
  const tier = deriveEmissionsTier(year ? parseInt(year, 10) : null, Boolean(hasDef));

  const canNext = [
    machineClass !== null,
    driveType !== null,
    hasDef !== null,
    /^\d{4}$/.test(year),
    make.trim() && model.trim() && serial.trim(),
    /^\d+$/.test(hourMeter),
    /^\d+$/.test(hoursPerWeek),
    customerId !== null,
    true,
    template !== null,
  ][step];

  const checkSerial = () => {
    const existing = machinesRepo.bySerial(serial);
    if (existing) {
      Alert.alert('Serial already registered', `${existing.serial_number} is already set up. Opening that machine instead.`, [
        {text: 'Open machine', onPress: () => nav.replace('Machine', {machineId: existing.id})},
      ]);
      return false;
    }
    return true;
  };

  const next = () => {
    if (step === 4 && !checkSerial()) {
      return;
    }
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  };

  const writeTag = async () => {
    // We do not know the Unique Machine ID until the server creates the row, so
    // the tag UID is read now and the NDEF payload is written after creation.
    const id = await writeMachineId('pending');
    if (id) {
      setTagId(id);
    } else {
      Alert.alert('NFC unavailable', 'Skip for now and link a tag later from the machine screen.');
    }
  };

  const finish = async () => {
    if (!sync.online) {
      Alert.alert('Connection required', 'Machine setup registers the serial number on the server. Connect and try again.');
      return;
    }
    if (!template || !user) {
      return;
    }
    setBusy(true);
    try {
      const res = await api.createMachine({
        customer_id: customerId,
        serial_number: serial.trim(),
        nfc_tag_id: tagId,
        make: make.trim(),
        model: model.trim(),
        year: parseInt(year, 10),
        machine_class: machineClass,
        drive_type: driveType,
        has_def: hasDef,
        current_hour_meter: parseInt(hourMeter, 10),
        estimated_hours_per_week: parseInt(hoursPerWeek, 10),
      });
      const machine = res.data;
      machinesRepo.upsert(machine);
      if (!templatesRepo.find(machine.checklist_template_id)) {
        const t = await api.templates(null);
        t.data.forEach(x => templatesRepo.upsert(x));
      }
      if (res.existing) {
        Alert.alert('Serial already registered', 'Opened the existing machine instead of creating a duplicate.');
        nav.replace('Machine', {machineId: machine.id});
        return;
      }
      if (tagId) {
        await writeMachineId(machine.id).catch(() => null);
      }
      // The baseline is the first walkthrough; it starts now.
      const inspection = startInspection({machineId: machine.id, technician: user, deviceId, hourMeter: parseInt(hourMeter, 10), type: 'baseline'});
      nav.replace('Walkthrough', {inspectionId: inspection.client_generated_id});
    } catch (e) {
      Alert.alert('Setup failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const choice = <T,>(options: Array<{v: T; label: string}>, value: T | null, set: (v: T) => void) => (
    <View style={styles.choices}>
      {options.map(o => (
        <Pressable key={String(o.v)} onPress={() => set(o.v)} style={[styles.choice, value === o.v && styles.choiceOn]}>
          <Text style={[styles.choiceText, value === o.v && {color: '#fff'}]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <Screen>
      <Muted>
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </Muted>
      <Title>{STEPS[step]}</Title>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Card>
          {step === 0 && choice(CLASSES, machineClass, setMachineClass)}
          {step === 1 &&
            choice(
              [
                {v: 'wheeled' as DriveType, label: 'Wheeled'},
                {v: 'tracked' as DriveType, label: 'Tracked'},
              ],
              driveType,
              setDriveType,
            )}
          {step === 2 && (
            <>
              <Muted>Physically check for a DEF cap.</Muted>
              {choice(
                [
                  {v: true, label: 'DEF cap present'},
                  {v: false, label: 'No DEF cap'},
                ],
                hasDef,
                setHasDef,
              )}
            </>
          )}
          {step === 3 && (
            <>
              <Input value={year} onChangeText={setYear} keyboardType="number-pad" placeholder="Model year" maxLength={4} />
              {year.length === 4 ? <Muted>Emissions tier: {tier === 'tier_4' ? 'Tier 4' : 'Tier 3'}</Muted> : null}
            </>
          )}
          {step === 4 && (
            <>
              <Label>Make</Label>
              <Input value={make} onChangeText={setMake} />
              <Label>Model</Label>
              <Input value={model} onChangeText={setModel} />
              <Label>Serial number</Label>
              <Input value={serial} onChangeText={setSerial} autoCapitalize="characters" autoCorrect={false} />
            </>
          )}
          {step === 5 && <Input value={hourMeter} onChangeText={setHourMeter} keyboardType="number-pad" placeholder="Current hour meter" />}
          {step === 6 && <Input value={hoursPerWeek} onChangeText={setHoursPerWeek} keyboardType="number-pad" placeholder="Estimated hours per week (owner supplied)" />}
          {step === 7 && choice(customers.map(c => ({v: c.id, label: c.name})), customerId, setCustomerId)}
          {step === 8 && (
            <>
              <Muted>{tagId ? `Tag ${tagId} will be linked.` : 'No tag yet. Write one now or skip and link it later.'}</Muted>
              <Button title="Write and link NFC tag" kind="secondary" onPress={writeTag} />
            </>
          )}
          {step === 9 && (
            <>
              {template ? (
                <Text style={styles.templateText}>
                  Locked checklist: {CLASSES.find(c => c.v === machineClass)?.label} · version {template.version} · {template.items.length} items
                </Text>
              ) : (
                <Text style={{color: colors.high}}>No published checklist on this device for that machine. Sync and try again.</Text>
              )}
              <Muted>The template version is locked to this machine and auto loads every visit. The baseline walkthrough starts immediately.</Muted>
            </>
          )}
        </Card>
      </ScrollView>
      <View style={styles.nav}>
        <Button title="Back" kind="secondary" onPress={() => (step === 0 ? nav.goBack() : setStep(s => s - 1))} style={{flex: 1}} />
        {step < STEPS.length - 1 ? (
          <Button title="Next" onPress={next} disabled={!canNext} style={{flex: 2}} />
        ) : (
          <Button title="Create machine and start baseline" onPress={finish} loading={busy} disabled={!canNext} style={{flex: 2}} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  choices: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},
  choice: {paddingVertical: 18, paddingHorizontal: 22, borderRadius: 12, borderWidth: 2, borderColor: colors.border, minWidth: 160, alignItems: 'center'},
  choiceOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  choiceText: {fontSize: 18, fontWeight: '600', color: colors.text},
  templateText: {fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 8},
  nav: {flexDirection: 'row', gap: 12},
});
