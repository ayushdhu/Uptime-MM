import React, {useCallback, useState} from 'react';
import {Alert, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Button, Card, Input, Muted, Screen, Title, colors} from '../components/ui';
import {SyncBar} from '../components/SyncBar';
import {customers as customersRepo, machines as machinesRepo} from '../db/repositories';
import type {Machine} from '../domain/types';
import {nfcStatus, openNfcSettings, subscribeToTags, type NfcStatus} from '../services/nfc';
import {resolveTag} from '../services/tagResolution';
import {useApp} from '../state/AppContext';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const {user, logout, refreshSyncStatus, sync, api} = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Machine[]>([]);
  const [nfc, setNfc] = useState<NfcStatus>('ready');
  const [resolving, setResolving] = useState(false);

  const onTag = useCallback(
    async (tagId: string) => {
      setResolving(true);
      try {
        const res = await resolveTag(tagId, api, sync.online);
        if (res.kind === 'machine') {
          nav.navigate('Machine', {machineId: res.machine.id});
        } else {
          nav.navigate('UnregisteredTag', {tagId});
        }
      } finally {
        setResolving(false);
      }
    },
    [api, sync.online, nav],
  );

  // Android delivers tag intents to the foreground activity: listen while this
  // screen is focused, release on blur so other screens (tag writing) can use NFC.
  useFocusEffect(
    useCallback(() => {
      refreshSyncStatus();
      setResults(query ? machinesRepo.search(query) : machinesRepo.all().slice(0, 30));
      const unsubscribe = subscribeToTags(onTag, setNfc);
      return unsubscribe;
    }, [refreshSyncStatus, query, onTag]),
  );

  const recheckNfc = async () => {
    const status = await nfcStatus();
    setNfc(status);
    if (status === 'disabled') {
      Alert.alert('NFC is switched off', 'Turn NFC on in system settings to open machines by tag, or search by serial number below.', [
        {text: 'Search instead'},
        {text: 'Open settings', onPress: () => openNfcSettings()},
      ]);
    }
  };

  const search = (text: string) => {
    setQuery(text);
    setResults(text ? machinesRepo.search(text) : machinesRepo.all().slice(0, 30));
  };

  return (
    <Screen>
      <SyncBar onOpen={() => nav.navigate('Sync')} />
      <View style={styles.headerRow}>
        <Title>Machines</Title>
        <Pressable onPress={() => Alert.alert('Sign out', `${user?.name}`, [{text: 'Cancel'}, {text: 'Sign out', style: 'destructive', onPress: logout}])}>
          <Muted>{user?.name}</Muted>
        </Pressable>
      </View>
      {nfc === 'ready' ? (
        <Card style={styles.nfcCard}>
          <Text style={styles.nfcText}>{resolving ? 'Looking up tag…' : 'Hold the tablet against the machine tag to open it'}</Text>
        </Card>
      ) : (
        <Card style={[styles.nfcCard, styles.nfcOff]}>
          <Text style={styles.nfcText}>
            {nfc === 'disabled' ? 'NFC is switched off on this tablet. Search by serial number, or turn NFC on.' : 'This tablet has no NFC reader. Search by serial number.'}
          </Text>
          {nfc === 'disabled' ? <Button title="Turn on NFC" kind="secondary" onPress={recheckNfc} /> : null}
        </Card>
      )}
      <Input value={query} onChangeText={search} placeholder="Serial number or customer name" autoCapitalize="characters" style={styles.search} />
      <FlatList
        data={results}
        keyExtractor={m => m.id}
        style={{marginTop: 10}}
        ListEmptyComponent={<Muted>No machines on this device yet. Sync to pull your assigned customers.</Muted>}
        renderItem={({item}) => (
          <Pressable onPress={() => nav.navigate('Machine', {machineId: item.id})}>
            <Card>
              <Text style={styles.serial}>{item.serial_number}</Text>
              <Muted>
                {item.make} {item.model} · {item.machine_class.replace('_', ' ')} · {customersRepo.find(item.customer_id)?.name ?? item.customer_id}
              </Muted>
            </Card>
          </Pressable>
        )}
      />
      {(user?.role === 'senior_technician' || user?.role === 'admin') && (
        <Button title="Set up a new machine" kind="secondary" onPress={() => nav.navigate('SetupWizard', {})} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  nfcCard: {borderColor: colors.primary, borderWidth: 2, alignItems: 'center'},
  nfcOff: {borderColor: colors.medium},
  nfcText: {fontSize: 17, fontWeight: '600', color: colors.text, textAlign: 'center'},
  search: {marginTop: 4},
  serial: {fontSize: 18, fontWeight: '700', color: colors.text},
});
