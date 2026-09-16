/** Android delivers several intents for one tap: the listener must produce one lookup. */
jest.mock('react-native-nfc-manager', () => {
  const listeners: Record<string, ((tag: unknown) => void) | null> = {};
  const manager = {
    listeners,
    isSupported: jest.fn(),
    start: jest.fn(),
    isEnabled: jest.fn(),
    setEventListener: jest.fn(),
    registerTagEvent: jest.fn(),
    unregisterTagEvent: jest.fn(),
    getLaunchTagEvent: jest.fn(),
    goToNfcSetting: jest.fn(),
    requestTechnology: jest.fn(),
    getTag: jest.fn(),
    cancelTechnologyRequest: jest.fn(),
    ndefHandler: {writeNdefMessage: jest.fn()},
  };
  return {
    __esModule: true,
    default: manager,
    NfcEvents: {DiscoverTag: 'NfcManagerDiscoverTag', SessionClosed: 'NfcManagerSessionClosed'},
    NfcTech: {Ndef: 'Ndef', NfcA: 'NfcA'},
    Ndef: {encodeMessage: () => [1, 2, 3], textRecord: (t: string) => t},
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockNfc = (jest.requireMock('react-native-nfc-manager') as any).default;
const mockListeners: Record<string, ((tag: unknown) => void) | null> = mockNfc.listeners;

// The jest preset resets mock implementations between tests; reinstall them each time.
function installNfcMock() {
  jest.clearAllMocks();
  mockNfc.isSupported.mockResolvedValue(true);
  mockNfc.start.mockResolvedValue(undefined);
  mockNfc.isEnabled.mockResolvedValue(true);
  mockNfc.setEventListener.mockImplementation((name: string, cb: ((tag: unknown) => void) | null) => {
    mockListeners[name] = cb;
  });
  mockNfc.registerTagEvent.mockResolvedValue(undefined);
  mockNfc.unregisterTagEvent.mockResolvedValue(undefined);
  mockNfc.getLaunchTagEvent.mockResolvedValue({id: 'aa:bb'});
  mockNfc.goToNfcSetting.mockResolvedValue(true);
  mockNfc.requestTechnology.mockResolvedValue(undefined);
  mockNfc.getTag.mockResolvedValue({id: '04aabbcc'});
  mockNfc.cancelTechnologyRequest.mockResolvedValue(undefined);
  mockNfc.ndefHandler.writeNdefMessage.mockResolvedValue(undefined);
}
beforeEach(installNfcMock);

import {createTagDebouncer, getLaunchTagId, nfcStatus, subscribeToTags, writeMachineId} from '../src/services/nfc';

const flush = () => new Promise<void>(r => setTimeout(() => r(), 0));

describe('tag debounce', () => {
  it('reports the same tag once within the window and again after it', () => {
    let t = 1000;
    const should = createTagDebouncer(2500, () => t);
    expect(should('A')).toBe(true);
    expect(should('A')).toBe(false);
    t += 1000;
    expect(should('A')).toBe(false);
    expect(should('B')).toBe(true); // a different tag is never suppressed
    t += 3000;
    expect(should('B')).toBe(true);
  });
});

describe('subscribeToTags', () => {

  it('registers on subscribe, collapses repeated intents for one tap into one lookup, and releases on unsubscribe', async () => {
    const onTag = jest.fn();
    const onStatus = jest.fn();
    const unsubscribe = subscribeToTags(onTag, onStatus);
    await flush();
    expect(onStatus).toHaveBeenCalledWith('ready');
    expect(mockNfc.registerTagEvent).toHaveBeenCalledTimes(1);
    const deliver = mockListeners.NfcManagerDiscoverTag!;
    deliver({id: '04aabbcc'});
    deliver({id: '04AABBCC'});
    deliver({id: '04aabbcc'});
    expect(onTag).toHaveBeenCalledTimes(1);
    expect(onTag).toHaveBeenCalledWith('04AABBCC');
    deliver({id: '04ddeeff'});
    expect(onTag).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(mockNfc.setEventListener).toHaveBeenLastCalledWith('NfcManagerDiscoverTag', null);
    expect(mockNfc.unregisterTagEvent).toHaveBeenCalledTimes(1);
  });

  it('reports NFC switched off instead of registering, so the screen falls back to serial search', async () => {
    mockNfc.isEnabled.mockResolvedValue(false);
    const onTag = jest.fn();
    const onStatus = jest.fn();
    subscribeToTags(onTag, onStatus);
    await flush();
    expect(await nfcStatus()).toBe('disabled');
    expect(onStatus).toHaveBeenCalledWith('disabled');
    expect(mockNfc.registerTagEvent).not.toHaveBeenCalled();
  });
});

describe('cold start and tag write', () => {
  it('returns the launch tag once', async () => {
    mockNfc.isEnabled.mockResolvedValue(true);
    expect(await getLaunchTagId()).toBe('AA:BB');
    expect(await getLaunchTagId()).toBeNull();
  });

  it('writes the machine id while the tag is held and reports phases', async () => {
    const phases: string[] = [];
    const uid = await writeMachineId('machine-1', p => phases.push(p));
    expect(uid).toBe('04AABBCC');
    expect(phases).toEqual(['waiting', 'writing', 'done']);
    expect(mockNfc.ndefHandler.writeNdefMessage).toHaveBeenCalled();
    expect(mockNfc.cancelTechnologyRequest).toHaveBeenCalled();
  });
});
