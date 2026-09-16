import RNFS from 'react-native-fs';
import type {FileSystem} from '../sync/engine';

/**
 * App private storage root. RNFS.DocumentDirectoryPath is the platform-correct
 * private directory: on Android it is Context.getFilesDir() (internal storage,
 * not the gallery, not external storage, removed with the app). Every photo and
 * signature path derives from this one constant.
 */
export const APP_PRIVATE_DIR = `${RNFS.DocumentDirectoryPath}/uptime`;
export const PHOTO_DIR = `${APP_PRIVATE_DIR}/photos`;
export const SIGNATURE_DIR = `${APP_PRIVATE_DIR}/signatures`;

export async function ensureDirs(): Promise<void> {
  for (const dir of [PHOTO_DIR, SIGNATURE_DIR]) {
    if (!(await RNFS.exists(dir))) {
      await RNFS.mkdir(dir);
    }
  }
}

export const nativeFileSystem: FileSystem = {
  async readFile(path) {
    const base64 = await RNFS.readFile(path, 'base64');
    return base64ToArrayBuffer(base64);
  },
  deleteFile: path => RNFS.unlink(path),
  exists: path => RNFS.exists(path),
};

export function sha256File(path: string): Promise<string> {
  return RNFS.hash(path, 'sha256');
}

export async function fileSize(path: string): Promise<number> {
  const stat = await RNFS.stat(path);
  return Number(stat.size);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Dependency free base64 decode (no Buffer/atob assumptions on the RN runtime).
 * Byte length is derived from the number of significant characters only; an
 * earlier version also subtracted the padding count, which truncated every
 * file whose size was not a multiple of 3 and produced server side SHA-256
 * mismatches on confirm (pilot run 1b).
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const length = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(length);
  let buffer = 0;
  let bits = 0;
  let out = 0;
  for (let i = 0; i < clean.length; i++) {
    buffer = ((buffer << 6) | B64.indexOf(clean[i])) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (out < length) {
        bytes[out++] = (buffer >> bits) & 0xff;
      }
    }
  }
  return bytes.buffer;
}
