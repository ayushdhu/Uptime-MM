# frozen_string_literal: true

module Uptime
  # Minimal hand-rolled factories: no fixtures, every record built through the
  # same validations the API uses.
  module TestFactories
    def create_user(role: "technician", customer: nil, **attrs)
      n = SecureRandom.hex(3)
      User.create!({ name: "User #{n}", email: "user-#{n}@example.com", password: "password-#{n}", role: role,
                     customer: customer }.merge(attrs))
    end

    def create_customer(**attrs)
      Customer.create!({ name: "Customer #{SecureRandom.hex(3)}", service_cadence: "weekly" }.merge(attrs))
    end

    def assign(user, customer)
      CustomerAssignment.find_or_create_by!(user: user, customer: customer)
    end

    def create_machine(customer:, machine_class: "skid_steer", drive_type: "wheeled", has_def: true, year: 2019, **attrs)
      template = ChecklistTemplate.select_for(machine_class: machine_class, drive_type: drive_type, has_def: has_def)
      Machine.create!({ customer: customer, serial_number: "SN-#{SecureRandom.hex(4)}", nfc_tag_id: "TAG-#{SecureRandom.hex(4)}",
                        make: "Bobcat", model: "S650", year: year, machine_class: machine_class, drive_type: drive_type,
                        has_def: has_def, checklist_template: template, current_hour_meter: 100 }.merge(attrs))
    end

    def create_inspection(machine:, technician:, **attrs)
      Inspection.create!({ machine: machine, technician: technician, inspection_type: "walkthrough",
                           performed_at: Time.current, hour_meter_reading: 120, client_generated_id: SecureRandom.uuid,
                           device_id: "ipad-test" }.merge(attrs))
    end

    def create_item(inspection:, position: nil, key: nil, result_type: "tiered", **attrs)
      position ||= (inspection.items.maximum(:position) || -1) + 1
      InspectionItem.create!({ inspection: inspection, template_item_key: key || "item_#{position}", position: position,
                               component_name: "Component #{position}", result_type: result_type,
                               severity: (result_type == "tiered" ? "low" : nil), pass: (result_type == "pass_fail" ? true : nil),
                               client_generated_id: SecureRandom.uuid }.merge(attrs))
    end

    def store_object(key, bytes)
      Storage.write(key, bytes)
      Digest::SHA256.hexdigest(bytes)
    end

    def create_photo(item:, **attrs)
      key = ObjectKeys.photo(item.inspection_id, SecureRandom.uuid)
      bytes = "jpegbytes-#{SecureRandom.hex(8)}"
      sha = store_object(key, bytes)
      Photo.create!({ inspection_item: item, s3_key: key, sha256: sha, byte_size: bytes.bytesize, captured_at: Time.current,
                      client_generated_id: SecureRandom.uuid }.merge(attrs))
    end

    def create_signature(inspection:, signature_type: "visit_checkout", **attrs)
      Signature.create!({ inspection: inspection, signature_type: signature_type, signer_name: "Owner Olly",
                          signer_role: "owner", signer_statement: "Looks fine to me", signed_at: Time.current,
                          client_generated_id: SecureRandom.uuid, device_id: "ipad-test" }.merge(attrs))
    end

    def complete_and_lock!(inspection, items: 2)
      items.times { create_photo(item: create_item(inspection: inspection)) }
      create_signature(inspection: inspection)
      inspection.lock!
      inspection
    end

    # Tiny valid 1x1 PNG so Prawn can embed a signature image.
    def png_bytes
      Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
    end
  end
end
