# frozen_string_literal: true

# The whole MVP schema in one migration. Every identifier is a UUID, every table
# carries created_at/updated_at, and the inspection chain (inspections,
# inspection_items, photos, signatures, inspection_notes) always chains back to
# machines.id. See docs/spec.md section 4.
class CreateUptimeSchema < ActiveRecord::Migration[8.1]
  def up
    enable_extension "pgcrypto"

    create_enum :service_cadence, %w[weekly biweekly monthly]
    create_enum :payment_terms, %w[due_on_receipt net_30 net_60]
    create_enum :machine_class, %w[skid_steer wheel_loader excavator dozer farm_tractor]
    create_enum :drive_type, %w[wheeled tracked]
    create_enum :emissions_tier, %w[tier_3 tier_4]
    create_enum :user_role, %w[technician senior_technician admin owner]
    create_enum :inspection_type, %w[walkthrough pm_100hr baseline]
    create_enum :inspection_status, %w[in_progress completed locked]
    create_enum :result_type, %w[tiered pass_fail measurement]
    create_enum :severity, %w[low medium high]
    create_enum :retention_state, %w[full thumbnail_only]
    create_enum :signature_type, %w[visit_checkout high_severity_ack]
    create_enum :note_author_role, %w[technician admin owner]
    create_enum :consumable_type, %w[fuel_filter air_filter hydraulic_filter cabin_filter engine_oil hydraulic_oil belt_pto belt_ac belt_alternator other]
    create_enum :consumable_source, %w[uptime_changed date_read_from_part unknown]

    create_table :customers, id: :uuid do |t|
      t.string :name, null: false
      t.text :billing_address
      t.text :site_address
      t.string :contact_name
      t.string :contact_phone
      t.string :contact_email
      t.enum :service_cadence, enum_type: :service_cadence, null: false, default: "weekly"
      t.enum :payment_terms, enum_type: :payment_terms, null: false, default: "due_on_receipt" # LATER: billing
      t.boolean :active, null: false, default: true
      t.timestamps
    end
    add_index :customers, "lower(name)"

    create_table :users, id: :uuid do |t|
      t.string :name, null: false
      t.string :email, null: false
      t.string :phone
      t.string :password_digest, null: false
      t.enum :role, enum_type: :user_role, null: false, default: "technician"
      t.references :customer, type: :uuid, foreign_key: true, null: true # owner role only, LATER
      t.boolean :active, null: false, default: true
      t.timestamps
    end
    add_index :users, "lower(email)", unique: true

    # Which technicians may see which customers' machines (spec section 8).
    create_table :customer_assignments, id: :uuid do |t|
      t.references :user, type: :uuid, foreign_key: true, null: false
      t.references :customer, type: :uuid, foreign_key: true, null: false
      t.timestamps
    end
    add_index :customer_assignments, %i[user_id customer_id], unique: true

    # Per device/user bearer tokens. Only the SHA-256 digest is stored.
    create_table :api_tokens, id: :uuid do |t|
      t.references :user, type: :uuid, foreign_key: true, null: false
      t.string :device_id, null: false
      t.string :token_digest, null: false
      t.datetime :last_used_at
      t.datetime :revoked_at
      t.timestamps
    end
    add_index :api_tokens, :token_digest, unique: true

    create_table :checklist_templates, id: :uuid do |t|
      t.enum :machine_class, enum_type: :machine_class, null: false
      t.enum :drive_type, enum_type: :drive_type, null: true # null = applies to both
      t.boolean :has_def, null: true                         # null = applies to both
      t.string :version, null: false
      t.jsonb :items, null: false, default: []
      t.datetime :published_at
      t.timestamps
    end
    add_index :checklist_templates, %i[machine_class drive_type has_def version], unique: true,
              name: "index_checklist_templates_on_variant_and_version"
    add_index :checklist_templates, :published_at

    create_table :machines, id: :uuid do |t|
      t.references :customer, type: :uuid, foreign_key: true, null: false
      t.string :serial_number, null: false
      t.string :nfc_tag_id
      t.string :make
      t.string :model
      t.integer :year
      t.enum :machine_class, enum_type: :machine_class, null: false
      t.enum :drive_type, enum_type: :drive_type, null: false
      t.boolean :has_def, null: false, default: false
      t.enum :emissions_tier, enum_type: :emissions_tier, null: false
      t.references :checklist_template, type: :uuid, foreign_key: true, null: false
      t.integer :current_hour_meter
      t.integer :estimated_hours_per_week
      t.integer :next_100hr_due_at_hours # LATER
      t.boolean :active, null: false, default: true
      t.timestamps
    end
    add_index :machines, :serial_number, unique: true
    add_index :machines, :nfc_tag_id, unique: true

    create_table :nfc_tag_history, id: :uuid do |t|
      t.references :machine, type: :uuid, foreign_key: true, null: false
      t.string :nfc_tag_id, null: false
      t.datetime :assigned_at, null: false
      t.datetime :removed_at
      t.references :assigned_by_user, type: :uuid, foreign_key: { to_table: :users }, null: true
      t.timestamps
    end

    create_table :inspections, id: :uuid do |t|
      t.references :machine, type: :uuid, foreign_key: true, null: false, index: false
      t.references :customer, type: :uuid, foreign_key: true, null: false # snapshot at inspection time
      t.references :technician, type: :uuid, foreign_key: { to_table: :users }, null: false, index: false
      t.references :checklist_template, type: :uuid, foreign_key: true, null: false
      t.string :checklist_version, null: false
      t.enum :inspection_type, enum_type: :inspection_type, null: false, default: "walkthrough"
      t.datetime :performed_at, null: false
      t.datetime :completed_at
      t.datetime :synced_at
      t.integer :hour_meter_reading, null: false
      t.enum :status, enum_type: :inspection_status, null: false, default: "in_progress"
      t.datetime :locked_at
      t.string :device_id
      t.uuid :client_generated_id, null: false
      t.timestamps
    end
    add_index :inspections, %i[machine_id performed_at], order: { performed_at: :desc }
    add_index :inspections, :client_generated_id, unique: true
    add_index :inspections, %i[technician_id performed_at]

    create_table :inspection_items, id: :uuid do |t|
      t.references :inspection, type: :uuid, foreign_key: true, null: false, index: false
      t.string :template_item_key, null: false
      t.integer :position, null: false
      t.string :component_name, null: false
      t.enum :result_type, enum_type: :result_type, null: false
      t.enum :severity, enum_type: :severity
      t.boolean :pass
      t.decimal :measurement_value, precision: 12, scale: 3
      t.string :measurement_unit
      t.jsonb :measurement_detail, null: false, default: {} # tire refill readings, battery tester verdict, codes
      t.text :technician_note
      t.boolean :skipped, null: false, default: false
      t.text :skip_reason
      t.references :carried_forward_from_item, type: :uuid, foreign_key: { to_table: :inspection_items }, null: true
      t.uuid :client_generated_id, null: false
      t.timestamps
    end
    add_index :inspection_items, %i[inspection_id position], unique: true
    add_index :inspection_items, :client_generated_id, unique: true
    add_check_constraint :inspection_items, "NOT skipped OR skip_reason IS NOT NULL", name: "inspection_items_skip_reason_required"

    create_table :photos, id: :uuid do |t|
      t.references :inspection_item, type: :uuid, foreign_key: true, null: false
      t.string :s3_key, null: false
      t.string :s3_url
      t.string :sha256, null: false, limit: 64
      t.bigint :byte_size
      t.datetime :captured_at, null: false
      t.datetime :uploaded_at
      t.integer :width
      t.integer :height
      t.string :thumbnail_s3_key
      t.enum :retention_state, enum_type: :retention_state, null: false, default: "full"
      t.uuid :client_generated_id, null: false
      t.timestamps
    end
    add_index :photos, :sha256
    add_index :photos, :s3_key, unique: true
    add_index :photos, :client_generated_id, unique: true
    add_check_constraint :photos, "sha256 ~ '^[0-9a-f]{64}$'", name: "photos_sha256_hex"

    create_table :signatures, id: :uuid do |t|
      t.references :inspection, type: :uuid, foreign_key: true, null: false
      t.enum :signature_type, enum_type: :signature_type, null: false
      t.string :signer_name, null: false
      t.string :signer_role
      t.text :signer_statement
      t.string :image_s3_key
      t.string :sha256, limit: 64
      t.datetime :signed_at, null: false
      t.string :device_id
      t.uuid :client_generated_id, null: false
      t.timestamps
    end
    add_index :signatures, :client_generated_id, unique: true

    create_table :high_severity_events, id: :uuid do |t|
      t.references :inspection_item, type: :uuid, foreign_key: true, null: false
      t.references :machine, type: :uuid, foreign_key: true, null: false, index: false
      t.datetime :opened_at, null: false
      t.jsonb :conversation_checklist, null: false, default: {}
      t.boolean :machine_out_of_service, null: false
      t.integer :recheck_interval_days
      t.text :repair_plan
      t.references :owner_signature, type: :uuid, foreign_key: { to_table: :signatures }, null: false
      t.datetime :resolved_at
      t.references :resolved_by_user, type: :uuid, foreign_key: { to_table: :users }, null: true
      t.references :resolved_in_inspection, type: :uuid, foreign_key: { to_table: :inspections }, null: true
      t.text :resolution_note
      t.uuid :client_generated_id, null: false
      t.timestamps
    end
    add_index :high_severity_events, :machine_id, where: "resolved_at IS NULL", name: "index_open_high_severity_events_on_machine_id"
    add_index :high_severity_events, :client_generated_id, unique: true
    add_check_constraint :high_severity_events,
                         "machine_out_of_service OR recheck_interval_days IS NOT NULL",
                         name: "high_severity_events_recheck_required_when_in_service"

    create_table :inspection_notes, id: :uuid do |t|
      t.references :inspection, type: :uuid, foreign_key: true, null: false, index: false
      t.references :inspection_item, type: :uuid, foreign_key: true, null: true
      t.references :author_user, type: :uuid, foreign_key: { to_table: :users }, null: false
      t.enum :author_role, enum_type: :note_author_role, null: false
      t.text :body, null: false
      t.uuid :client_generated_id, null: false
      t.datetime :created_at, null: false
      t.datetime :updated_at, null: false # required by Rails; the trigger forbids any UPDATE
    end
    add_index :inspection_notes, %i[inspection_id created_at]
    add_index :inspection_notes, :client_generated_id, unique: true

    create_table :consumable_records, id: :uuid do |t|
      t.references :machine, type: :uuid, foreign_key: true, null: false
      t.references :inspection, type: :uuid, foreign_key: true, null: true
      t.enum :consumable_type, enum_type: :consumable_type, null: false
      t.date :changed_at
      t.integer :hour_meter_at_change
      t.enum :source, enum_type: :consumable_source, null: false, default: "unknown"
      t.integer :interval_hours
      t.text :note
      t.timestamps
    end

    create_table :discrepancy_alerts, id: :uuid do |t|
      t.references :machine, type: :uuid, foreign_key: true, null: false
      t.references :inspection_a, type: :uuid, foreign_key: { to_table: :inspections }, null: false
      t.references :inspection_b, type: :uuid, foreign_key: { to_table: :inspections }, null: false
      t.datetime :reviewed_at
      t.references :reviewed_by_user, type: :uuid, foreign_key: { to_table: :users }, null: true
      t.timestamps
    end
    add_index :discrepancy_alerts, %i[inspection_a_id inspection_b_id], unique: true

    # Generated PDF report, stored in S3 with its own hash (spec 5.5).
    create_table :inspection_reports, id: :uuid do |t|
      t.references :inspection, type: :uuid, foreign_key: true, null: false, index: { unique: true }
      t.string :s3_key, null: false
      t.string :sha256, null: false, limit: 64
      t.bigint :byte_size, null: false
      t.integer :page_count, null: false
      t.datetime :generated_at, null: false
      t.timestamps
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
