# frozen_string_literal: true

# Database level immutability (spec 4.5). Application code mirrors this with
# `readonly?`, but the triggers are the real guarantee.
class AddImmutabilityTriggers < ActiveRecord::Migration[8.1]
  def up
    execute <<~SQL
      -- Helper: is the inspection locked?
      CREATE OR REPLACE FUNCTION uptime_inspection_locked(p_inspection_id uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT EXISTS (SELECT 1 FROM inspections WHERE id = p_inspection_id AND status = 'locked');
      $$;

      -- inspections: once locked, only synced_at (and updated_at) may change; never deleted.
      CREATE OR REPLACE FUNCTION uptime_guard_inspection() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD.status = 'locked' THEN
            RAISE EXCEPTION 'inspection % is locked and cannot be deleted', OLD.id
              USING ERRCODE = 'integrity_constraint_violation';
          END IF;
          RETURN OLD;
        END IF;
        IF OLD.status = 'locked' THEN
          IF (to_jsonb(OLD) - 'synced_at' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'synced_at' - 'updated_at') THEN
            RAISE EXCEPTION 'inspection % is locked; only synced_at may be set', OLD.id
              USING ERRCODE = 'integrity_constraint_violation';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER inspections_immutable_when_locked
        BEFORE UPDATE OR DELETE ON inspections
        FOR EACH ROW EXECUTE FUNCTION uptime_guard_inspection();

      -- inspection_items: no insert/update/delete once the parent is locked.
      CREATE OR REPLACE FUNCTION uptime_guard_inspection_item() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        v_inspection_id uuid;
      BEGIN
        v_inspection_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.inspection_id ELSE NEW.inspection_id END;
        IF uptime_inspection_locked(v_inspection_id) OR (TG_OP = 'UPDATE' AND uptime_inspection_locked(OLD.inspection_id)) THEN
          RAISE EXCEPTION 'inspection % is locked; inspection_items are immutable', v_inspection_id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER inspection_items_immutable_when_locked
        BEFORE INSERT OR UPDATE OR DELETE ON inspection_items
        FOR EACH ROW EXECUTE FUNCTION uptime_guard_inspection_item();

      -- photos: no insert/delete once locked; updates limited to upload bookkeeping.
      CREATE OR REPLACE FUNCTION uptime_guard_photo() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        v_item_id uuid;
        v_inspection_id uuid;
      BEGIN
        v_item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.inspection_item_id ELSE NEW.inspection_item_id END;
        SELECT inspection_id INTO v_inspection_id FROM inspection_items WHERE id = v_item_id;
        IF uptime_inspection_locked(v_inspection_id) THEN
          IF TG_OP = 'UPDATE' AND OLD.inspection_item_id = NEW.inspection_item_id AND
             (to_jsonb(OLD) - 'uploaded_at' - 'retention_state' - 's3_url' - 'thumbnail_s3_key' - 'updated_at')
             IS NOT DISTINCT FROM
             (to_jsonb(NEW) - 'uploaded_at' - 'retention_state' - 's3_url' - 'thumbnail_s3_key' - 'updated_at') THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'inspection % is locked; photos are immutable', v_inspection_id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER photos_immutable_when_locked
        BEFORE INSERT OR UPDATE OR DELETE ON photos
        FOR EACH ROW EXECUTE FUNCTION uptime_guard_photo();

      -- signatures: no insert/update/delete once locked.
      CREATE OR REPLACE FUNCTION uptime_guard_signature() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        v_inspection_id uuid;
      BEGIN
        v_inspection_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.inspection_id ELSE NEW.inspection_id END;
        IF uptime_inspection_locked(v_inspection_id) OR (TG_OP = 'UPDATE' AND uptime_inspection_locked(OLD.inspection_id)) THEN
          RAISE EXCEPTION 'inspection % is locked; signatures are immutable', v_inspection_id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER signatures_immutable_when_locked
        BEFORE INSERT OR UPDATE OR DELETE ON signatures
        FOR EACH ROW EXECUTE FUNCTION uptime_guard_signature();

      -- inspection_notes: append only, unconditionally.
      CREATE OR REPLACE FUNCTION uptime_reject_change() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '% is append only; % is not permitted', TG_TABLE_NAME, TG_OP
          USING ERRCODE = 'integrity_constraint_violation';
      END;
      $$;
      CREATE TRIGGER inspection_notes_append_only
        BEFORE UPDATE OR DELETE ON inspection_notes
        FOR EACH ROW EXECUTE FUNCTION uptime_reject_change();

      -- Dedicated functions for the only permitted post-lock updates.
      CREATE OR REPLACE FUNCTION uptime_mark_inspection_synced(p_inspection_id uuid, p_synced_at timestamptz) RETURNS void
      LANGUAGE sql AS $$
        UPDATE inspections SET synced_at = p_synced_at, updated_at = now() WHERE id = p_inspection_id;
      $$;

      CREATE OR REPLACE FUNCTION uptime_mark_photo_uploaded(p_photo_id uuid, p_uploaded_at timestamptz, p_thumbnail_key text) RETURNS void
      LANGUAGE sql AS $$
        UPDATE photos SET uploaded_at = p_uploaded_at, thumbnail_s3_key = COALESCE(p_thumbnail_key, thumbnail_s3_key), updated_at = now()
        WHERE id = p_photo_id;
      $$;

      CREATE OR REPLACE FUNCTION uptime_set_photo_retention(p_photo_id uuid, p_state retention_state) RETURNS void
      LANGUAGE sql AS $$
        UPDATE photos SET retention_state = p_state, updated_at = now() WHERE id = p_photo_id;
      $$;
    SQL
  end

  def down
    execute <<~SQL
      DROP TRIGGER IF EXISTS inspections_immutable_when_locked ON inspections;
      DROP TRIGGER IF EXISTS inspection_items_immutable_when_locked ON inspection_items;
      DROP TRIGGER IF EXISTS photos_immutable_when_locked ON photos;
      DROP TRIGGER IF EXISTS signatures_immutable_when_locked ON signatures;
      DROP TRIGGER IF EXISTS inspection_notes_append_only ON inspection_notes;
      DROP FUNCTION IF EXISTS uptime_guard_inspection, uptime_guard_inspection_item, uptime_guard_photo,
        uptime_guard_signature, uptime_reject_change, uptime_inspection_locked,
        uptime_mark_inspection_synced, uptime_mark_photo_uploaded, uptime_set_photo_retention;
    SQL
  end
end
