import React, {useCallback, useState} from 'react';
import {Alert, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Button, Card, Input, Muted, Screen, Title, colors} from '../components/ui';
import {SyncBar} from '../components/SyncBar';
import {customers as customersRepo, machines as machinesRepo} from '../db/repositories';
import type {Machine} from '../domain/types';
import {readTagId} from '../services/nfc';
import {useApp} from '../state/AppContext';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const {user, logout, refreshSyncStatus, sync, api} = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Machine[]>([]);
  const [scanning, setScanning] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshSyncStatus();
      setResults(query ? machinesRepo.search(query) : machinesRepo.all().slice(0, 30));
    }, [refreshSyncStatus, query]),
  );

  const scan = async () => {
    setScanning(true);
    try {
      const tagId = await readTagId();
      if (!tagId) {
        Alert.alert('NFC unavailable', 'Could not read a tag. Search by serial number instead.');
        return;
      }
      let machine = machinesRepo.byNfc(tagId);
      if (!machine && sync.online) {
        try {
          const res = await api.lookupMachine({nfc: tagId});
          machine = res.data as Machine;
          machinesRepo.upsert(machine);
        } catch {
          machine = null;
        }
      }
      if (machine) {
        nav.navigate('Machine', {machineId: machine.id});
      } else {
        nav.navigate('UnregisteredTag', {tagId});
      }
    } finally {
      setScanning(false);
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
      <Button title={scanning ? 'Hold iPad near tag…' : 'Tap NFC tag'} onPress={scan} loading={scanning} />
      <Input value={query} onChangeText={search} placeholder="Serial number or customer name" autoCapitalize="characters" style={{marginTop: 12}} />
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
  serial: {fontSize: 18, fontWeight: '700', color: colors.text},
});
