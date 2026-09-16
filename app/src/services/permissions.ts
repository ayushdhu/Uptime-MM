import {PermissionsAndroid, Platform, type Permission} from 'react-native';

export type PermissionOutcome = 'granted' | 'denied' | 'blocked';

export interface PermissionDeps {
  os: string;
  check: (p: Permission) => Promise<boolean>;
  request: (p: Permission, rationale?: {title: string; message: string; buttonPositive: string}) => Promise<string>;
}

const defaultDeps: PermissionDeps = {
  os: Platform.OS,
  check: p => PermissionsAndroid.check(p),
  request: (p, rationale) => PermissionsAndroid.request(p, rationale),
};

/**
 * Android asks for CAMERA at runtime. Requested lazily, right before the first
 * photo of a walkthrough, never at app launch. 'blocked' means the technician
 * chose "don't ask again" and must enable it from system settings.
 */
export async function ensureCameraPermission(deps: PermissionDeps = defaultDeps): Promise<PermissionOutcome> {
  if (deps.os !== 'android') {
    return 'granted';
  }
  const perm = PermissionsAndroid.PERMISSIONS.CAMERA;
  if (await deps.check(perm)) {
    return 'granted';
  }
  const result = await deps.request(perm, {
    title: 'Camera access',
    message: 'Uptime photographs every inspection point. Photos stay private in the app and are never saved to your gallery.',
    buttonPositive: 'Allow',
  });
  if (result === PermissionsAndroid.RESULTS.GRANTED) {
    return 'granted';
  }
  return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
}

export const CAMERA_BLOCKED_MESSAGE =
  'A photo is required on every item, so the walkthrough cannot continue without camera access. ' +
  'Grant camera permission to Uptime and come back; the inspection stays in progress.';
