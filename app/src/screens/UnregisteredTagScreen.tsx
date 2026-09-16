import React, {useState} from 'react';
import {Alert} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Button, Card, Input, Label, Muted, Screen, Title} from '../components/ui';
import {machines as machinesRepo} from '../db/repositories';
import {useApp} from '../state/AppContext';
import type {RootStackParamList} from '../navigation/types';

/** Tag reads but no machine matches: link it to an existing machine by serial, or start the wizard. */
export function UnregisteredTagScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {params} = useRoute<RouteProp<RootStackParamList, 'UnregisteredTag'>>();
  const {api, user, sync} = useApp();
  const [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false);
  const senior = user?.role === 'senior_technician' || user?.role === 'admin';

  const link = async () => {
    const machine = machinesRepo.bySerial(serial);
    if (!machine) {
      Alert.alert('Not found', 'No machine with that serial number on this device. Sync and try again.');
      return;
    }
    if (!sync.online) {
      Alert.alert('Offline', 'Re-tagging needs a connection so the tag is registered on the server.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.retag(machine.id, params.tagId);
      machinesRepo.upsert(res.data);
      nav.replace('Machine', {machineId: machine.id});
    } catch (e) {
      Alert.alert('Could not link tag', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Unregistered tag</Title>
      <Muted>Tag {params.tagId} is not linked to any machine.</Muted>
      <Card style={{marginTop: 16}}>
        <Label>Link to an existing machine by serial number</Label>
        <Input value={serial} onChangeText={setSerial} autoCapitalize="characters" placeholder="Serial number" />
        <Button title="Link tag" onPress={link} loading={busy} disabled={!serial || !senior} />
        {!senior ? <Muted>Only a senior technician can re-tag a machine.</Muted> : null}
      </Card>
      <Card>
        <Label>Or set up a new machine</Label>
        <Button title="Start setup wizard" kind="secondary" onPress={() => nav.replace('SetupWizard', {tagId: params.tagId})} disabled={!senior} />
      </Card>
    </Screen>
  );
}
