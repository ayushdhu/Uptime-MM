import NfcManager, {Ndef, NfcEvents, NfcTech, type TagEvent} from 'react-native-nfc-manager';

/**
 * Android NFC: tags are delivered as intents to the foreground activity, not
 * through an on-demand scan sheet. Screens subscribe on focus and release on
 * blur; a cold start by tag is read from the launch intent; repeated intents
 * for one physical tap are debounced.
 */
export type NfcStatus = 'ready' | 'disabled' | 'unsupported';

let started = false;

async function start(): Promise<boolean> {
  try {
    if (!(await NfcManager.isSupported())) {
      return false;
    }
    if (!started) {
      await NfcManager.start();
      started = true;
    }
    return true;
  } catch {
    return false;
  }
}

/** 'disabled' = NFC switched off in system settings: fall back to serial search and say why. */
export async function nfcStatus(): Promise<NfcStatus> {
  if (!(await start())) {
    return 'unsupported';
  }
  try {
    return (await NfcManager.isEnabled()) ? 'ready' : 'disabled';
  } catch {
    return 'disabled';
  }
}

export function openNfcSettings(): Promise<boolean> {
  return NfcManager.goToNfcSetting();
}

export function tagIdOf(tag: TagEvent | null | undefined): string | null {
  return tag?.id ? String(tag.id).toUpperCase() : null;
}

/**
 * Pure debounce: the same tag id within `windowMs` is reported once. Different
 * tags are always reported. Exported for tests.
 */
export function createTagDebouncer(windowMs = 2500, now: () => number = Date.now) {
  let lastId: string | null = null;
  let lastAt = 0;
  return (tagId: string): boolean => {
    const t = now();
    if (tagId === lastId && t - lastAt < windowMs) {
      lastAt = t;
      return false;
    }
    lastId = tagId;
    lastAt = t;
    return true;
  };
}

/**
 * Register foreground tag dispatch. Call on focus; call the returned function on
 * blur/unmount. Resolves to the NFC status so the caller can explain a fallback.
 */
export function subscribeToTags(onTag: (tagId: string) => void, onStatus?: (s: NfcStatus) => void): () => void {
  let active = true;
  const shouldReport = createTagDebouncer();
  (async () => {
    const status = await nfcStatus();
    onStatus?.(status);
    if (status !== 'ready' || !active) {
      return;
    }
    NfcManager.setEventListener(NfcEvents.DiscoverTag, (tag: TagEvent) => {
      const id = tagIdOf(tag);
      if (id && shouldReport(id)) {
        onTag(id);
      }
    });
    try {
      await NfcManager.registerTagEvent();
    } catch {
      onStatus?.('disabled');
    }
  })();
  return () => {
    active = false;
    NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
    NfcManager.unregisterTagEvent().catch(() => undefined);
  };
}

/** Cold start: the app was launched by a tag. Returns the tag id once; later calls return null. */
let launchTagConsumed = false;
export async function getLaunchTagId(): Promise<string | null> {
  if (launchTagConsumed || !(await start())) {
    return null;
  }
  launchTagConsumed = true;
  try {
    return tagIdOf(await NfcManager.getLaunchTagEvent());
  } catch {
    return null;
  }
}

export type WritePhase = 'waiting' | 'writing' | 'done' | 'error';

/**
 * Write the machine's Unique Machine ID onto a tag. On Android the tag must be
 * in range at the moment of write, so this waits ("hold the tag against the
 * tablet") until a tag arrives or `cancelTagWrite()` is called. Returns the tag
 * UID, which becomes machines.nfc_tag_id.
 */
export async function writeMachineId(machineId: string, onPhase?: (p: WritePhase) => void): Promise<string | null> {
  if ((await nfcStatus()) !== 'ready') {
    return null;
  }
  onPhase?.('waiting');
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef);
    const tag = await NfcManager.getTag();
    onPhase?.('writing');
    const bytes = Ndef.encodeMessage([Ndef.textRecord(`uptime:${machineId}`)]);
    if (bytes) {
      await NfcManager.ndefHandler.writeNdefMessage(bytes);
    }
    onPhase?.('done');
    return tagIdOf(tag);
  } catch (e) {
    onPhase?.('error');
    throw e;
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => undefined);
  }
}

/** Read one tag's UID by waiting for it (used by the wizard when no launch/foreground tag was seen). */
export async function readTagIdOnce(): Promise<string | null> {
  if ((await nfcStatus()) !== 'ready') {
    return null;
  }
  try {
    await NfcManager.requestTechnology([NfcTech.Ndef, NfcTech.NfcA]);
    return tagIdOf(await NfcManager.getTag());
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => undefined);
  }
}

export function cancelTagWrite(): void {
  NfcManager.cancelTechnologyRequest().catch(() => undefined);
}
