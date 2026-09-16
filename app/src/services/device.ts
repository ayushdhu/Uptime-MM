import DeviceInfo from 'react-native-device-info';
import {getMeta, setMeta} from '../db/database';

/** Stable per install identifier for `device_id` on every inspection row. */
export async function getDeviceId(): Promise<string> {
  const cached = getMeta('device_id');
  if (cached) {
    return cached;
  }
  let id: string;
  try {
    id = await DeviceInfo.getUniqueId();
  } catch {
    id = `ipad-${Math.random().toString(36).slice(2, 10)}`;
  }
  setMeta('device_id', id);
  return id;
}
