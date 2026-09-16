import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import Pdf from 'react-native-pdf';
import {Button, Muted, colors} from './ui';
import type {ReportDownload} from '../services/reportDownload';

/** Renders the downloaded server PDF inside the app (Android WebView cannot display PDFs). */
export function ServerPdfView({download, onRetry}: {download: ReportDownload | null; onRetry: () => void}) {
  if (!download || download.status === 'downloading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Muted>Fetching the server PDF…</Muted>
      </View>
    );
  }
  if (download.status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Could not fetch the server PDF: {download.message}</Text>
        <Button title="Try again" kind="secondary" onPress={onRetry} />
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      {!download.verified ? <Text style={styles.err}>Warning: the PDF hash does not match the hash the server reported at lock time.</Text> : null}
      <Pdf source={{uri: `file://${download.path}`}} style={styles.pdf} trustAllCerts={false} />
      <Muted>SHA-256 {download.sha256.slice(0, 16)}… {download.verified ? '(verified)' : ''}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {flex: 1},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8},
  pdf: {flex: 1, backgroundColor: '#eee'},
  err: {color: colors.high, fontWeight: '600', textAlign: 'center', marginBottom: 6},
});
