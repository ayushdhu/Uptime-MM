import React, {useCallback, useMemo, useState} from 'react';
import {Alert, Image, Linking, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Button, Card, Input, Label, Muted, PassFailButtons, ProgressBar, Screen, TierButtons, colors} from '../components/ui';
import {inspections as inspectionsRepo, items as itemsRepo, photos as photosRepo} from '../db/repositories';
import {itemCompletionError, forcedSeverity} from '../domain/checklist';
import type {InspectionItem, MeasurementDetail, Photo, Severity, TemplateItem} from '../domain/types';
import {gradeItem, markItemDone, pendingHighItems, skipItem, templateItemByKey} from '../services/inspectionFlow';
import {photoUri, requestPhotoCapture} from '../services/photos';
import {CAMERA_BLOCKED_MESSAGE} from '../services/permissions';
import type {RootStackParamList} from '../navigation/types';

/** One item per screen, in template order. Photo first, then the result controls unlock (spec 5.3). */
export function WalkthroughScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {params} = useRoute<RouteProp<RootStackParamList, 'Walkthrough'>>();
  const inspection = inspectionsRepo.find(params.inspectionId);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [index, setIndex] = useState(0);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [note, setNote] = useState('');
  const [skipReason, setSkipReason] = useState('');
  const [showSkip, setShowSkip] = useState(false);
  const [measure, setMeasure] = useState('');
  const [detail, setDetail] = useState<MeasurementDetail>({});
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const templates = useMemo(() => (inspection ? templateItemByKey(inspection) : new Map<string, TemplateItem>()), [inspection]);

  const loadItem = useCallback(
    (list: InspectionItem[], i: number) => {
      const it = list[i];
      if (!it) {
        return;
      }
      setPhotos(photosRepo.forItem(it.client_generated_id));
      setNote(it.technician_note ?? '');
      setSkipReason(it.skip_reason ?? '');
      setShowSkip(it.skipped);
      setMeasure(it.measurement_value === null ? '' : String(it.measurement_value));
      setDetail(it.measurement_detail ?? {});
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      const list = itemsRepo.forInspection(params.inspectionId);
      setItems(list);
      const firstOpen = Math.max(0, list.findIndex(i => !i.done));
      const i = firstOpen === -1 ? 0 : firstOpen;
      setIndex(i);
      loadItem(list, i);
    }, [params.inspectionId, loadItem]),
  );

  if (!inspection || inspection.status === 'locked') {
    return (
      <Screen>
        <Muted>This inspection is locked. Open it from the machine screen to view it or add a note.</Muted>
      </Screen>
    );
  }
  const item = items[index];
  if (!item) {
    return (
      <Screen>
        <Muted>No items.</Muted>
      </Screen>
    );
  }
  const template = templates.get(item.template_item_key);
  const doneCount = items.filter(i => i.done).length;
  const photoLocked = photos.length === 0 && (template ? template.result_type !== 'measurement' || template.photo_required : true);
  const forced = template ? forcedSeverity(template, detail) : null;

  const refresh = (updated: InspectionItem) => {
    const list = items.map(i => (i.client_generated_id === updated.client_generated_id ? updated : i));
    setItems(list);
  };

  const takePhoto = async () => {
    try {
      const result = await requestPhotoCapture(inspection.client_generated_id, item.client_generated_id);
      if (result.status === 'permission_denied') {
        // A photo is required on every item: block here, keep the inspection in_progress.
        setCameraBlocked(true);
        return;
      }
      setCameraBlocked(false);
      if (result.status === 'captured') {
        setPhotos(photosRepo.forItem(item.client_generated_id));
      }
    } catch (e) {
      Alert.alert('Photo failed', (e as Error).message);
    }
  };

  const setSeverity = (s: Severity) => refresh(gradeItem(item, template, {severity: s, measurementDetail: detail, technicianNote: note || null}));
  const setPass = (v: boolean) => refresh(gradeItem(item, template, {pass: v, technicianNote: note || null}));

  const applyMeasurement = (text: string, nextDetail: MeasurementDetail = detail) => {
    setMeasure(text);
    const value = text.trim() === '' ? null : Number(text);
    refresh(gradeItem(item, template, {measurementValue: isNaN(Number(value)) ? null : value, measurementDetail: nextDetail, technicianNote: note || null}));
  };

  const goTo = (i: number) => {
    setIndex(i);
    loadItem(items, i);
  };

  const advance = () => {
    let current = items[index];
    if (showSkip) {
      try {
        current = skipItem(current, skipReason);
      } catch (e) {
        Alert.alert('Skip', (e as Error).message);
        return;
      }
    } else {
      current = gradeItem(current, template, {technicianNote: note || null, measurementDetail: detail});
      const err = itemCompletionError(current, template, photos.length);
      if (err) {
        Alert.alert('Not done yet', err);
        return;
      }
      current = markItemDone(current);
    }
    const list = items.map(i => (i.client_generated_id === current.client_generated_id ? current : i));
    setItems(list);
    const nextOpen = list.findIndex((i, idx) => idx > index && !i.done);
    if (nextOpen !== -1) {
      setIndex(nextOpen);
      loadItem(list, nextOpen);
      return;
    }
    const anyOpen = list.findIndex(i => !i.done);
    if (anyOpen !== -1) {
      setIndex(anyOpen);
      loadItem(list, anyOpen);
      return;
    }
    // Walk finished: High flow first (spec 5.3), then checkout.
    inspectionsRepo.complete(inspection.client_generated_id, new Date().toISOString());
    if (pendingHighItems(inspection.client_generated_id).length > 0) {
      nav.replace('HighSeverityFlow', {inspectionId: inspection.client_generated_id});
    } else {
      nav.replace('Checkout', {inspectionId: inspection.client_generated_id});
    }
  };

  return (
    <Screen>
      <ProgressBar done={doneCount} total={items.length} />
      <ScrollView keyboardShouldPersistTaps="handled">
        <Card style={item.carried_forward_from_item_id ? {borderColor: colors.high, borderWidth: 2} : undefined}>
          {item.carried_forward_from_item_id ? <Text style={styles.recheck}>MANDATORY RECHECK of an open High finding. Fresh photo and fresh tier required.</Text> : null}
          <Muted>
            {template?.walkthrough_group ?? template?.section} · {template?.cadence_label ?? item.result_type}
          </Muted>
          <Text style={styles.component}>{item.component_name}</Text>
          <Text style={styles.method}>Check: {template?.check_method_label ?? template?.check_method ?? 'visual'}</Text>
          {template?.notes_to_tech ? <Muted>{template.notes_to_tech}</Muted> : null}
          {template && item.result_type !== 'pass_fail' ? (
            <View style={styles.criteria}>
              {(['low', 'medium', 'high'] as const).map(t => (
                <View key={t} style={styles.critRow}>
                  <Text style={[styles.critTier, {color: colors[t]}]}>{t.toUpperCase()}</Text>
                  <Text style={styles.critText}>{template.tier_criteria[t] ?? 'n/a'}</Text>
                </View>
              ))}
            </View>
          ) : template ? (
            <View style={styles.criteria}>
              <View style={styles.critRow}>
                <Text style={[styles.critTier, {color: colors.pass}]}>PASS</Text>
                <Text style={styles.critText}>{template.tier_criteria.low}</Text>
              </View>
              <View style={styles.critRow}>
                <Text style={[styles.critTier, {color: colors.fail}]}>FAIL</Text>
                <Text style={styles.critText}>{template.tier_criteria.high}</Text>
              </View>
            </View>
          ) : null}
        </Card>

        {cameraBlocked ? (
          <Card style={styles.blocked}>
            <Text style={styles.blockedTitle}>Camera access needed</Text>
            <Text style={styles.blockedText}>{CAMERA_BLOCKED_MESSAGE}</Text>
            <View style={styles.nav}>
              <Button title="Open app settings" kind="secondary" onPress={() => Linking.openSettings()} style={styles.flex1} />
              <Button title="Try again" onPress={takePhoto} style={styles.flex1} />
            </View>
          </Card>
        ) : null}
        <Card>
          <Label>Photos ({photos.length}) — required before grading</Label>
          <ScrollView horizontal style={{marginBottom: 8}}>
            {photos.map(p => {
              const uri = photoUri(p);
              return uri ? <Image key={p.client_generated_id} source={{uri}} style={styles.thumb} /> : null;
            })}
          </ScrollView>
          <Button title={photos.length ? 'Take another photo' : 'Take photo'} onPress={takePhoto} kind={photos.length ? 'secondary' : 'primary'} />
        </Card>

        <Card style={photoLocked ? {opacity: 0.4} : undefined} pointerEvents={photoLocked ? 'none' : 'auto'}>
          {item.result_type === 'measurement' && template?.measurement ? (
            <MeasurementControls
              template={template}
              value={measure}
              detail={detail}
              onValue={applyMeasurement}
              onDetail={d => {
                setDetail(d);
                applyMeasurement(measure, d);
              }}
            />
          ) : null}
          {forced ? <Text style={styles.forced}>Auto graded {forced.toUpperCase()} by the {template?.measurement?.flow === 'battery' ? 'battery' : 'tire refill'} rule.</Text> : null}
          {item.result_type === 'pass_fail' ? (
            <PassFailButtons value={item.pass} onChange={setPass} />
          ) : (
            <TierButtons value={item.severity} onChange={setSeverity} />
          )}
          <Muted>When in doubt, round up.</Muted>
          <Label>Technician note (optional)</Label>
          <Input value={note} onChangeText={setNote} multiline placeholder="What you saw, in your words" style={{minHeight: 70}} />
        </Card>

        <Card>
          {showSkip ? (
            <>
              <Label>Reason for skipping (required)</Label>
              <Input value={skipReason} onChangeText={setSkipReason} placeholder="e.g. attachment not on machine today" />
              <Button title="Cancel skip" kind="ghost" onPress={() => setShowSkip(false)} />
            </>
          ) : (
            <Button title="Skip this item (requires a typed reason)" kind="ghost" onPress={() => setShowSkip(true)} />
          )}
        </Card>
      </ScrollView>
      <View style={styles.nav}>
        <Button title="Previous" kind="secondary" onPress={() => goTo(Math.max(0, index - 1))} disabled={index === 0} style={{flex: 1}} />
        <Button title={doneCount >= items.length - 1 && !items.some((i, idx) => idx !== index && !i.done) ? 'Finish walkthrough' : 'Next item'} onPress={advance} style={{flex: 2}} />
      </View>
    </Screen>
  );
}

function MeasurementControls({
  template,
  value,
  detail,
  onValue,
  onDetail,
}: {
  template: TemplateItem;
  value: string;
  detail: MeasurementDetail;
  onValue: (v: string) => void;
  onDetail: (d: MeasurementDetail) => void;
}) {
  const m = template.measurement!;
  const [refill, setRefill] = useState({initial: '', one: '', five: ''});
  const commitRefill = (next: typeof refill) => {
    setRefill(next);
    if (next.initial && next.one && next.five) {
      onDetail({...detail, tire_refill: {initial_psi: Number(next.initial), one_minute_psi: Number(next.one), five_minute_psi: Number(next.five)}});
    }
  };
  return (
    <View>
      <Label>
        Reading ({m.unit}){m.reference !== null ? ` · reference ${m.reference}${m.reference_24v ? ` (12 V) / ${m.reference_24v} (24 V)` : ''}` : ''}
      </Label>
      <Input value={value} onChangeText={onValue} keyboardType="decimal-pad" placeholder={m.unit} />
      {m.flow === 'tire_refill_test' ? (
        <View>
          <Label>Low pressure refill test (if the tire read low)</Label>
          <Muted>Refill, then record psi at 1 minute and again at 5 minutes. A drop = active leak = High.</Muted>
          <View style={styles.row3}>
            <Input value={refill.initial} onChangeText={t => commitRefill({...refill, initial: t})} keyboardType="decimal-pad" placeholder="Refilled to" style={{flex: 1}} />
            <Input value={refill.one} onChangeText={t => commitRefill({...refill, one: t})} keyboardType="decimal-pad" placeholder="At 1 min" style={{flex: 1}} />
            <Input value={refill.five} onChangeText={t => commitRefill({...refill, five: t})} keyboardType="decimal-pad" placeholder="At 5 min" style={{flex: 1}} />
          </View>
        </View>
      ) : null}
      {m.flow === 'battery' ? (
        <View>
          <Label>Battery tester verdict</Label>
          <View style={styles.row3}>
            {(['good', 'low', 'dead', 'bad'] as const).map(v => (
              <Button
                key={v}
                title={v.toUpperCase()}
                kind={detail.battery?.tester_verdict === v ? (v === 'good' ? 'primary' : 'danger') : 'secondary'}
                onPress={() => onDetail({...detail, battery: {tester_verdict: v}})}
                style={{flex: 1}}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  component: {fontSize: 26, fontWeight: '700', color: colors.text, marginVertical: 6},
  method: {fontSize: 16, color: colors.text, marginBottom: 6},
  criteria: {marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8},
  critRow: {flexDirection: 'row', marginBottom: 6},
  critTier: {width: 90, fontWeight: '800', fontSize: 14},
  critText: {flex: 1, fontSize: 15, color: colors.text},
  thumb: {width: 110, height: 110, borderRadius: 8, marginRight: 8, backgroundColor: '#ddd'},
  recheck: {color: colors.high, fontWeight: '800', marginBottom: 6},
  forced: {color: colors.high, fontWeight: '700', marginTop: 8},
  nav: {flexDirection: 'row', gap: 12},
  row3: {flexDirection: 'row', gap: 8, marginTop: 4},
  flex1: {flex: 1},
  blocked: {borderColor: colors.high, borderWidth: 2},
  blockedTitle: {fontSize: 18, fontWeight: '800', color: colors.high},
  blockedText: {fontSize: 15, color: colors.text, marginTop: 6},
});
