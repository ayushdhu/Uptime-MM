import type {ApiClient} from '../api/client';
import {machines as machinesRepo} from '../db/repositories';
import type {Machine} from '../domain/types';

export type TagResolution = {kind: 'machine'; machine: Machine} | {kind: 'unregistered'; tagId: string};

/**
 * A tag id resolves to machines.nfc_tag_id: locally first (offline), then the
 * server when online. Unknown tags go to the unregistered-tag flow (spec 5.1).
 * Shared by the foreground listener and the cold-start launch intent.
 */
export async function resolveTag(tagId: string, api: ApiClient, online: boolean): Promise<TagResolution> {
  let machine = machinesRepo.byNfc(tagId);
  if (!machine && online) {
    try {
      const res = await api.lookupMachine({nfc: tagId});
      machine = res.data as Machine;
      machinesRepo.upsert(machine);
    } catch {
      machine = null;
    }
  }
  return machine ? {kind: 'machine', machine} : {kind: 'unregistered', tagId};
}
