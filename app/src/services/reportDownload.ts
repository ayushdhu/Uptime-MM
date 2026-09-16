import ReactNativeBlobUtil from 'react-native-blob-util';
import RNFS from 'react-native-fs';
import type {ApiClient} from '../api/client';
import {APP_PRIVATE_DIR, sha256File} from './files';

export type ReportDownload =
  | {status: 'downloading'}
  | {status: 'ready'; path: string; sha256: string; verified: boolean}
  | {status: 'error'; message: string};

/**
 * Fetch the server PDF in-app with the bearer token (never hand the URL to an
 * external viewer), keep it in app-private storage, and check its SHA-256
 * against the hash the server reported when it locked the inspection.
 */
export async function downloadServerReport(api: ApiClient, inspectionId: string, serverId: string, expectedSha256: string | null): Promise<ReportDownload> {
  const dir = `${APP_PRIVATE_DIR}/reports`;
  const path = `${dir}/${inspectionId}.pdf`;
  try {
    if (!(await RNFS.exists(dir))) {
      await RNFS.mkdir(dir);
    }
    const res = await ReactNativeBlobUtil.config({path, overwrite: true}).fetch('GET', api.reportUrl(serverId), {
      Authorization: `Bearer ${api.token ?? ''}`,
      Accept: 'application/pdf',
    });
    const status = res.info().status;
    if (status !== 200) {
      await RNFS.unlink(path).catch(() => undefined);
      return {status: 'error', message: status === 404 ? 'The server has no PDF for this inspection yet.' : `Server answered HTTP ${status}.`};
    }
    const sha256 = await sha256File(path);
    return {status: 'ready', path, sha256, verified: expectedSha256 === null || sha256 === expectedSha256};
  } catch (e) {
    return {status: 'error', message: (e as Error).message};
  }
}
