import React, {useRef} from 'react';
import {StyleSheet, View} from 'react-native';
import SignatureScreen, {type SignatureViewRef} from 'react-native-signature-canvas';
import {Button} from './ui';

/** Captures strokes and returns a PNG data URL. */
export function SignaturePad({onCaptured}: {onCaptured: (pngDataUrl: string) => void}) {
  const ref = useRef<SignatureViewRef>(null);
  return (
    <View style={styles.wrap}>
      <View style={styles.pad}>
        <SignatureScreen
          ref={ref}
          onOK={onCaptured}
          onEmpty={() => undefined}
          descriptionText=""
          webStyle=".m-signature-pad--footer {display: none;} .m-signature-pad {box-shadow: none; border: none;}"
          backgroundColor="#fff"
          penColor="#111"
          imageType="image/png"
        />
      </View>
      <View style={styles.row}>
        <Button title="Clear" kind="secondary" onPress={() => ref.current?.clearSignature()} style={{flex: 1}} />
        <Button title="Accept signature" onPress={() => ref.current?.readSignature()} style={{flex: 2}} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {marginTop: 8},
  pad: {height: 220, borderWidth: 2, borderColor: '#D5D9E0', borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff'},
  row: {flexDirection: 'row', gap: 12},
});
