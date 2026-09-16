import React, {useEffect, useMemo, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useRoute, type RouteProp} from '@react-navigation/native';
import {Button, Label, Muted, Screen, Title} from '../components/ui';
import {inspections as inspectionsRepo, items as itemsRepo, photos as photosRepo} from '../db/repositories';
import {photoUri} from '../services/photos';
import {useApp} from '../state/AppContext';
import type {RootStackParamList} from '../navigation/types';

interface Entry {
  id: string;
  uri: string;
  captured_at: string;
  visit: string;
  component: string;
  key: string;
}

/** Photos are not in the report; they are browsable here by visit date or by checklist item. */
export function PhotoBrowserScreen() {
  const {params} = useRoute<RouteProp<RootStackParamList, 'PhotoBrowser'>>();
  const {api, sync} = useApp();
  const [mode, setMode] = useState<'visit' | 'item'>('visit');
  const [remote, setRemote] = useState<Entry[]>([]);

  const local = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const insp of inspectionsRepo.forMachine(params.machineId)) {
      for (const it of itemsRepo.forInspection(insp.client_generated_id)) {
        for (const p of photosRepo.forItem(it.client_generated_id)) {
          const uri = photoUri(p);
          if (uri) {
            out.push({id: p.client_generated_id, uri, captured_at: p.captured_at, visit: insp.performed_at.slice(0, 10), component: it.component_name, key: it.template_item_key});
          }
        }
      }
    }
    return out;
  }, [params.machineId]);

  useEffect(() => {
    if (!sync.online) {
      return;
    }
    api
      .machineHistory(params.machineId)
      .then(res =>
        setRemote(
          res.data.photos.map(p => ({id: p.id, uri: p.url, captured_at: p.captured_at, visit: p.performed_at.slice(0, 10), component: p.component_name, key: p.template_item_key})),
        ),
      )
      .catch(() => undefined);
  }, [api, params.machineId, sync.online]);

  const seen = new Set<string>();
  const all = [...local, ...remote].filter(e => (seen.has(e.uri) ? false : (seen.add(e.uri), true)));
  const groups = new Map<string, Entry[]>();
  for (const e of all) {
    const g = mode === 'visit' ? e.visit : e.component;
    groups.set(g, [...(groups.get(g) ?? []), e]);
  }
  const keys = [...groups.keys()].sort((a, b) => (mode === 'visit' ? b.localeCompare(a) : a.localeCompare(b)));

  return (
    <Screen>
      <Title>Photos</Title>
      <View style={styles.row}>
        <Button title="By visit" kind={mode === 'visit' ? 'primary' : 'secondary'} onPress={() => setMode('visit')} style={{flex: 1}} />
        <Button title="By checklist item" kind={mode === 'item' ? 'primary' : 'secondary'} onPress={() => setMode('item')} style={{flex: 1}} />
      </View>
      <ScrollView>
        {keys.length === 0 ? <Muted>No photos for this machine on the device{sync.online ? ' or the server' : ''}.</Muted> : null}
        {keys.map(k => (
          <View key={k}>
            <Label>{k}</Label>
            <ScrollView horizontal>
              {groups.get(k)!.map(e => (
                <View key={e.id} style={styles.cell}>
                  <Image source={{uri: e.uri}} style={styles.img} />
                  <Text style={styles.cap}>{mode === 'visit' ? e.component : e.visit}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 10, marginBottom: 8},
  cell: {width: 150, marginRight: 8},
  img: {width: 150, height: 150, borderRadius: 8, backgroundColor: '#ddd'},
  cap: {fontSize: 11, color: '#5B6470', marginTop: 2},
});
