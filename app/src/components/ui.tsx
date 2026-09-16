import React from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle} from 'react-native';
import type {Severity} from '../domain/types';

export const colors = {
  bg: '#F4F5F7',
  card: '#FFFFFF',
  text: '#15171A',
  muted: '#5B6470',
  border: '#D5D9E0',
  primary: '#1D4ED8',
  low: '#2E7D32',
  medium: '#B26A00',
  high: '#B3261E',
  pass: '#2E7D32',
  fail: '#B3261E',
};

export function Screen({children, style}: {children?: React.ReactNode; style?: StyleProp<ViewStyle>}) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({children, style, pointerEvents}: {children?: React.ReactNode; style?: StyleProp<ViewStyle>; pointerEvents?: 'auto' | 'none'}) {
  return (
    <View style={[styles.card, style]} pointerEvents={pointerEvents}>
      {children}
    </View>
  );
}

export function Title({children}: {children: React.ReactNode}) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Label({children}: {children: React.ReactNode}) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Muted({children}: {children: React.ReactNode}) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const bg = kind === 'primary' ? colors.primary : kind === 'danger' ? colors.high : kind === 'secondary' ? '#E5E9F0' : 'transparent';
  const fg = kind === 'primary' || kind === 'danger' ? '#fff' : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({pressed}) => [styles.button, {backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1}, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, {color: fg}]}>{title}</Text>}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.input, props.style]} />;
}

/** Low / Medium / High. High is the largest, most prominent target: round up is the path of least resistance. */
export function TierButtons({value, onChange}: {value: Severity | null; onChange: (s: Severity) => void}) {
  const tiers: Array<{s: Severity; label: string; flex: number}> = [
    {s: 'low', label: 'LOW', flex: 1},
    {s: 'medium', label: 'MEDIUM', flex: 1},
    {s: 'high', label: 'HIGH', flex: 1.6},
  ];
  return (
    <View style={styles.row}>
      {tiers.map(t => (
        <Pressable
          key={t.s}
          accessibilityRole="button"
          accessibilityState={{selected: value === t.s}}
          onPress={() => onChange(t.s)}
          style={[styles.tier, {flex: t.flex, borderColor: colors[t.s], backgroundColor: value === t.s ? colors[t.s] : '#fff'}]}>
          <Text style={[styles.tierText, {color: value === t.s ? '#fff' : colors[t.s], fontSize: t.s === 'high' ? 28 : 20}]}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function PassFailButtons({value, onChange}: {value: boolean | null; onChange: (v: boolean) => void}) {
  return (
    <View style={styles.row}>
      {[
        {v: true, label: 'PASS', color: colors.pass},
        {v: false, label: 'FAIL', color: colors.fail},
      ].map(o => (
        <Pressable
          key={o.label}
          accessibilityRole="button"
          accessibilityState={{selected: value === o.v}}
          onPress={() => onChange(o.v)}
          style={[styles.tier, {flex: 1, borderColor: o.color, backgroundColor: value === o.v ? o.color : '#fff'}]}>
          <Text style={[styles.tierText, {color: value === o.v ? '#fff' : o.color}]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ProgressBar({done, total}: {done: number; total: number}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, {width: `${pct}%`}]} />
      </View>
      <Text style={styles.progressText}>
        {done} / {total} items
      </Text>
    </View>
  );
}

export function Checkbox({checked, label, onToggle}: {checked: boolean; label: string; onToggle: () => void}) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{checked}} onPress={onToggle} style={styles.checkRow}>
      <View style={[styles.checkBox, checked && {backgroundColor: colors.primary, borderColor: colors.primary}]}>
        {checked ? <Text style={{color: '#fff', fontWeight: '700'}}>✓</Text> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.bg, padding: 20},
  card: {backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.border},
  title: {fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 10},
  label: {fontSize: 14, fontWeight: '600', color: colors.muted, marginTop: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5},
  muted: {fontSize: 14, color: colors.muted},
  button: {paddingVertical: 14, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 8, minHeight: 56},
  buttonText: {fontSize: 17, fontWeight: '600'},
  input: {borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 17, backgroundColor: '#fff', color: colors.text},
  row: {flexDirection: 'row', gap: 12, marginTop: 8},
  // Gloved / wet-hand use: every grading target is at least 96dp tall. HIGH is wider and louder.
  tier: {borderWidth: 3, borderRadius: 12, paddingVertical: 26, minHeight: 96, alignItems: 'center', justifyContent: 'center'},
  tierText: {fontSize: 18, fontWeight: '800', letterSpacing: 1},
  progressWrap: {marginBottom: 12},
  progressTrack: {height: 10, backgroundColor: '#E1E5EC', borderRadius: 5, overflow: 'hidden'},
  progressFill: {height: 10, backgroundColor: colors.primary},
  progressText: {marginTop: 4, color: colors.muted, fontSize: 13},
  checkRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 14, minHeight: 56},
  checkBox: {width: 36, height: 36, borderWidth: 2, borderColor: colors.border, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginRight: 12},
  checkLabel: {fontSize: 17, color: colors.text, flex: 1},
});
