import RNFS from 'react-native-fs';
import type {FileSystem} from '../sync/engine';

/** App private storage (never the camera roll). */
export const PHOTO_DIR = `${RNFS.DocumentDirectoryPath}/uptime/photos`;
export const SIGNATURE_DIR = `${RNFS.DocumentDirectoryPath}/uptime/signatures`;

export async function ensureDirs(): Promise<void> {
  for (const dir of [PHOTO_DIR, SIGNATURE_DIR]) {
    if (!(await RNFS.exists(dir))) {
      await RNFS.mkdir(dir, {NSURLIsExcludedFromBackupKey: false});
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

/** Dependency free base64 decode (no Buffer/atob assumptions on the RN runtime). */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const padding = (base64.match(/=+$/) || [''])[0].length;
  const length = Math.floor((clean.length * 3) / 4) - padding;
  const bytes = new Uint8Array(length);
  let buffer = 0;
  let bits = 0;
  let out = 0;
  for (let i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | B64.indexOf(clean[i]);
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
