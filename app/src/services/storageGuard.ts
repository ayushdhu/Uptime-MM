import RNFS from 'react-native-fs';

export const WARN_BELOW_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const BLOCK_BELOW_BYTES = 500 * 1024 * 1024; // 500 MB

export type StorageVerdict = {level: 'ok' | 'warn' | 'block'; freeBytes: number; message: string};

export function judgeFreeSpace(freeBytes: number): StorageVerdict {
  const gb = (freeBytes / 1024 ** 3).toFixed(1);
  if (freeBytes < BLOCK_BELOW_BYTES) {
    return {
      level: 'block',
      freeBytes,
      message: `Only ${gb} GB free. Sync now or free space before starting a walkthrough. Photos would fail mid walk.`,
    };
  }
  if (freeBytes < WARN_BELOW_BYTES) {
    return {level: 'warn', freeBytes, message: `${gb} GB free. Sync soon to keep room for photos.`};
  }
  return {level: 'ok', freeBytes, message: `${gb} GB free.`};
}

/**
 * Spec 7.8: warn below 2 GB, block below 500 MB, before starting a walkthrough.
 * On Android RNFS.getFSInfo() reads StatFs(Environment.getDataDirectory()).getFreeBytes(),
 * i.e. bytes free on the internal partition that holds filesDir, where photos are
 * written. `freeSpaceEx` (external storage) is deliberately ignored.
 */
export async function checkFreeSpace(): Promise<StorageVerdict> {
  const info = await RNFS.getFSInfo();
  const free = Number(info.freeSpace);
  if (!Number.isFinite(free) || free < 0) {
    // A broken reading must not silently disable the guard.
    return {level: 'block', freeBytes: 0, message: 'Could not read free storage space. Sync and restart the app before starting a walkthrough.'};
  }
  return judgeFreeSpace(free);
}
