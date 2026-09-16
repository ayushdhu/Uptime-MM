/** Pilot run 1b: photos whose size was not a multiple of 3 failed SHA-256 on confirm. */
jest.mock('react-native-fs', () => ({DocumentDirectoryPath: '/data/user/0/com.uptimeapp/files'}));
import {base64ToArrayBuffer} from '../src/services/files';

test('decodes every byte for the exact photo sizes from the pilot and for all lengths mod 3', () => {
  for (const n of [32829, 33225, 33233, 32149, 0, 1, 2, 3, 4, 5, 6, 7]) {
    const original = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      original[i] = (i * 31 + 7) & 0xff;
    }
    const decoded = Buffer.from(base64ToArrayBuffer(original.toString('base64')));
    expect(decoded.length).toBe(n);
    expect(decoded.equals(original)).toBe(true);
  }
});

test('ignores whitespace and line breaks in the base64 input', () => {
  const original = Buffer.from('hello uptime, twenty-two bytes!');
  const wrapped = original.toString('base64').replace(/(.{8})/g, '$1\n');
  expect(Buffer.from(base64ToArrayBuffer(wrapped)).equals(original)).toBe(true);
});
