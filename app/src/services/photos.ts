import {launchCamera} from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import {v4 as uuid} from 'uuid';
import {PHOTO_DIR, ensureDirs, fileSize, sha256File} from './files';
import {photos as photosRepo, syncQueue} from '../db/repositories';
import type {Photo} from '../domain/types';

/**
 * Capture a photo for an inspection item: opens the camera, copies the file
 * into app private storage, hashes it with SHA-256 at capture, records it
 * locally and queues it for upload. Returns null if the technician cancelled.
 */
export async function capturePhoto(inspectionId: string, itemId: string): Promise<Photo | null> {
  await ensureDirs();
  const result = await launchCamera({
    mediaType: 'photo',
    cameraType: 'back',
    quality: 0.8,
    maxWidth: 2400,
    maxHeight: 2400,
    saveToPhotos: false, // never the camera roll
    includeExtra: true,
  });
  if (result.didCancel || !result.assets || result.assets.length === 0) {
    return null;
  }
  const asset = result.assets[0];
  if (!asset.uri) {
    throw new Error(result.errorMessage ?? 'camera returned no file');
  }
  const id = uuid();
  const dest = `${PHOTO_DIR}/${id}.jpg`;
  const src = asset.uri.replace(/^file:\/\//, '');
  await RNFS.moveFile(src, dest);
  const sha256 = await sha256File(dest);
  const photo: Photo = {
    client_generated_id: id,
    inspection_item_id: itemId,
    inspection_id: inspectionId,
    local_path: dest,
    s3_key: null,
    sha256,
    byte_size: asset.fileSize ?? (await fileSize(dest)),
    width: asset.width ?? null,
    height: asset.height ?? null,
    captured_at: new Date().toISOString(),
    uploaded_at: null,
    remote_url: null,
  };
  try {
    photosRepo.insert(photo);
  } catch (e) {
    // Never leave an orphaned file in private storage (e.g. the inspection locked meanwhile).
    await RNFS.unlink(dest).catch(() => undefined);
    throw e;
  }
  syncQueue.enqueue('photo', id, inspectionId);
  return photo;
}

export function photoUri(p: Photo): string | null {
  if (p.local_path) {
    return `file://${p.local_path}`;
  }
  return p.remote_url;
}
