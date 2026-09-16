import NfcManager, {NfcTech, Ndef} from 'react-native-nfc-manager';

let started = false;

export async function nfcSupported(): Promise<boolean> {
  try {
    const ok = await NfcManager.isSupported();
    if (ok && !started) {
      await NfcManager.start();
      started = true;
    }
    return ok;
  } catch {
    return false;
  }
}

/** Read the tag's hardware UID. The UID is the machine's nfc_tag_id. */
export async function readTagId(): Promise<string | null> {
  if (!(await nfcSupported())) {
    return null;
  }
  try {
    await NfcManager.requestTechnology([NfcTech.Ndef, NfcTech.NfcA, NfcTech.MifareIOS], {alertMessage: 'Hold the iPad near the machine tag'});
    const tag = await NfcManager.getTag();
    return tag?.id ? String(tag.id).toUpperCase() : null;
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => undefined);
  }
}

/** Write the machine's Unique Machine ID onto the tag as an NDEF text record and return the tag UID. */
export async function writeMachineId(machineId: string): Promise<string | null> {
  if (!(await nfcSupported())) {
    return null;
  }
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef, {alertMessage: 'Hold the iPad on the new tag to write it'});
    const tag = await NfcManager.getTag();
    const bytes = Ndef.encodeMessage([Ndef.textRecord(`uptime:${machineId}`)]);
    if (bytes) {
      await NfcManager.ndefHandler.writeNdefMessage(bytes);
    }
    return tag?.id ? String(tag.id).toUpperCase() : null;
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => undefined);
  }
}
