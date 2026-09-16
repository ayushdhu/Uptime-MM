import RNFS from 'react-native-fs';
import {v4 as uuid} from 'uuid';
import {SIGNATURE_DIR, ensureDirs, sha256File} from './files';
import {signatures as signaturesRepo, syncQueue} from '../db/repositories';
import type {Signature, SignatureType} from '../domain/types';

export interface SignatureInput {
  inspectionId: string;
  type: SignatureType;
  signerName: string;
  signerRole: string;
  signerStatement: string;
  /** data:image/png;base64,... from the signature pad */
  pngDataUrl: string;
  deviceId: string;
}

/** Render strokes to PNG in app private storage, hash it, store and queue it. */
export async function saveSignature(input: SignatureInput): Promise<Signature> {
  await ensureDirs();
  const id = uuid();
  const path = `${SIGNATURE_DIR}/${id}.png`;
  const base64 = input.pngDataUrl.replace(/^data:image\/png;base64,/, '');
  await RNFS.writeFile(path, base64, 'base64');
  const sha256 = await sha256File(path);
  const sig: Signature = {
    client_generated_id: id,
    server_id: null,
    inspection_id: input.inspectionId,
    signature_type: input.type,
    signer_name: input.signerName.trim(),
    signer_role: input.signerRole.trim(),
    signer_statement: input.signerStatement.trim(),
    local_path: path,
    image_s3_key: null,
    sha256,
    signed_at: new Date().toISOString(),
    device_id: input.deviceId,
    uploaded_at: null,
  };
  signaturesRepo.insert(sig);
  syncQueue.enqueue('signature', id, input.inspectionId);
  return sig;
}
