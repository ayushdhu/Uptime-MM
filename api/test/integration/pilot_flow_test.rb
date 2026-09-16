# frozen_string_literal: true

require "test_helper"

# Walks the definition of done (spec 12) through the HTTP API.
class PilotFlowTest < ActionDispatch::IntegrationTest
  setup do
    @customer = create_customer(name: "Pilot Yard")
    @admin = create_user(role: "admin")
    @senior = create_user(role: "senior_technician", password: "senior-pass")
    @tech = create_user(role: "technician", password: "tech-pass")
    @stranger = create_user(role: "technician", password: "stranger-pass")
    assign(@senior, @customer)
    assign(@tech, @customer)
    @tech_token = login(@tech, "tech-pass")
    @senior_token = login(@senior, "senior-pass")
    @admin_token = login(@admin, @admin.password)
    @stranger_token = login(@stranger, "stranger-pass")
  end

  test "full pilot: setup, offline walkthrough sync, High flow, lock, report, carry forward, notes" do
    # 1. Tap an unregistered tag, then run the setup wizard (senior technician).
    get "/api/v1/machines/lookup", params: { nfc: "04AABBCC" }, headers: auth(@tech_token)
    assert_response :not_found
    assert_equal "unregistered tag", body["message"]

    wizard = { customer_id: @customer.id, serial_number: "ss-1001", nfc_tag_id: "04AABBCC", make: "Bobcat", model: "S650",
               year: 2019, machine_class: "skid_steer", drive_type: "wheeled", has_def: true, current_hour_meter: 1200,
               estimated_hours_per_week: 20 }
    post "/api/v1/machines", params: { machine: wizard }, headers: auth(@tech_token), as: :json
    assert_response :forbidden, "plain technicians cannot run the setup wizard"
    post "/api/v1/machines", params: { machine: wizard }, headers: auth(@senior_token), as: :json
    assert_response :created
    machine = body["data"]
    assert_equal "SS-1001", machine["serial_number"]
    assert_equal "tier_4", machine["emissions_tier"]
    assert_equal "alpha-2", machine["checklist_version"]

    # Duplicate serial opens the existing machine instead of creating a new one.
    post "/api/v1/machines", params: { machine: wizard.merge(nfc_tag_id: nil) }, headers: auth(@senior_token), as: :json
    assert_response :ok
    assert body["existing"]
    assert_equal machine["id"], body["data"]["id"]

    # All three lookups resolve to the same Unique Machine ID.
    get "/api/v1/machines/lookup", params: { nfc: "04AABBCC" }, headers: auth(@tech_token)
    assert_equal machine["id"], body["data"]["id"]
    get "/api/v1/machines/lookup", params: { serial: "ss-1001" }, headers: auth(@tech_token)
    assert_equal machine["id"], body["data"]["id"]
    get "/api/v1/machines/lookup", params: { q: "pilot" }, headers: auth(@tech_token)
    assert_equal [machine["id"]], body["data"].map { |m| m["id"] }

    # A technician not assigned to the customer never sees the machine.
    get "/api/v1/machines/lookup", params: { nfc: "04AABBCC" }, headers: auth(@stranger_token)
    assert_response :not_found
    get "/api/v1/machines/#{machine['id']}", headers: auth(@stranger_token)
    assert_response :forbidden

    # 2. Baseline walkthrough performed offline, synced later: inspection first (idempotent).
    performed_at = 2.days.ago.change(usec: 0)
    insp_payload = { client_generated_id: SecureRandom.uuid, machine_id: machine["id"], inspection_type: "baseline",
                     performed_at: performed_at.iso8601, hour_meter_reading: 1204, device_id: "ipad-yard-1" }
    post "/api/v1/inspections", params: { inspection: insp_payload }, headers: auth(@tech_token, device_time: 20.minutes.ago), as: :json
    assert_response :created
    inspection = body["data"]
    assert_equal "in_progress", inspection["status"]
    assert_equal performed_at.utc.iso8601(3), inspection["performed_at"]
    assert inspection["synced_at"].present?
    assert response.headers["X-Clock-Skew-Seconds"].to_i > 600, "device clock skew over 10 minutes is flagged"
    post "/api/v1/inspections", params: { inspection: insp_payload }, headers: auth(@tech_token), as: :json
    assert_response :ok
    assert body["existing"]
    assert_equal inspection["id"], body["data"]["id"]

    # Items in a batch (every template item, in order, one graded High, one skipped with a reason).
    template_items = ChecklistTemplate.find(machine["checklist_template_id"]).items_for(Machine.find(machine["id"]))
    items = template_items.each_with_index.map do |ti, idx|
      base = { client_generated_id: SecureRandom.uuid, template_item_key: ti["key"], position: idx, component_name: ti["component"],
               result_type: ti["result_type"] }
      case ti["result_type"]
      when "tiered" then base.merge(severity: idx == 3 ? "high" : "low", technician_note: (idx == 3 ? "Steady drip under load" : nil))
      when "pass_fail" then base.merge(pass: true)
      when "measurement" then base.merge(measurement_value: 12.6, measurement_unit: ti.dig("measurement", "unit"), severity: "low")
      end
    end
    items[5] = items[5].slice(:client_generated_id, :template_item_key, :position, :component_name, :result_type)
                       .merge(skipped: true, skip_reason: "Attachment removed, cylinder not on machine")
    post "/api/v1/inspections/#{inspection['id']}/items", params: { items: items }, headers: auth(@tech_token), as: :json
    assert_response :ok
    server_items = body["data"]
    assert_equal template_items.size, server_items.size
    post "/api/v1/inspections/#{inspection['id']}/items", params: { items: items.first(2) }, headers: auth(@tech_token), as: :json
    assert_response :ok, "retrying a batch never duplicates"
    assert_equal template_items.size, Inspection.find(inspection["id"]).items.count
    bad = items.first.merge(client_generated_id: SecureRandom.uuid, position: 999, skipped: true, skip_reason: nil)
    post "/api/v1/inspections/#{inspection['id']}/items", params: { items: [bad] }, headers: auth(@tech_token), as: :json
    assert_response :unprocessable_content, "silent gaps are not allowed"

    # Photos: presign, upload, confirm with hash verification. Wrong hash is rejected.
    high_item = server_items.find { |i| i["severity"] == "high" }
    optional_keys = template_items.reject { |t| t["photo_required"] }.map { |t| t["key"] }
    assert optional_keys.any?, "alpha-2 marks behavioural function tests as photo optional"
    server_items.reject { |i| i["skipped"] || optional_keys.include?(i["template_item_key"]) }.each do |item|
      upload_photo!(item, "photo-of-#{item['template_item_key']}")
    end
    bad_key = presign!(server_items.first)
    put bad_key[:upload_url], params: "real bytes", headers: { "Content-Type" => "image/jpeg" }
    post "/api/v1/photos/confirm", params: { s3_key: bad_key[:s3_key], sha256: "f" * 64, inspection_item_id: server_items.first["id"],
                                             client_generated_id: bad_key[:client_id], captured_at: Time.current.iso8601 },
                                   headers: auth(@tech_token), as: :json
    assert_response :unprocessable_content
    assert_equal "hash_mismatch", body["error"]
    assert_match(/does not match the supplied SHA-256/, body["message"])
    post "/api/v1/photos/confirm", params: { s3_key: "inspections/nothing/photos/x.jpg", sha256: "f" * 64, inspection_item_id: server_items.first["id"],
                                             client_generated_id: SecureRandom.uuid, captured_at: Time.current.iso8601 },
                                   headers: auth(@tech_token), as: :json
    assert_response :unprocessable_content
    assert_equal "object_missing", body["error"]
    assert_match(/upload it to the presigned URL/, body["message"])
    post "/api/v1/photos/confirm", params: { s3_key: bad_key[:s3_key], sha256: "f" * 64, inspection_item_id: SecureRandom.uuid,
                                             client_generated_id: SecureRandom.uuid, captured_at: Time.current.iso8601 },
                                   headers: auth(@tech_token), as: :json
    assert_response :not_found
    assert_equal "item_not_found", body["error"]
    # Presign URLs are path-only without API_BASE_URL so the device resolves them against its own API host.
    assert bad_key[:upload_url].start_with?("/dev/storage/"), bad_key[:upload_url]

    # 3. High severity flow: conversation checklist + owner signature + event.
    post "/api/v1/inspections/#{inspection['id']}/lock", headers: auth(@tech_token), as: :json
    assert_response :unprocessable_content, "cannot lock before the High flow and checkout signature"
    assert_equal "not_lockable", body["error"]
    assert_includes body["details"].join, "High item(s) without a signed"
    assert_includes body["details"].join, "no checkout signature"
    assert_not_includes body["details"].join, "missing a required photo", "photo-optional items must not block locking"

    ack_sig_key = presign_signature!(inspection["id"])
    put ack_sig_key[:upload_url], params: png_bytes, headers: { "Content-Type" => "image/png" }
    ack_sig = { client_generated_id: ack_sig_key[:client_id], signature_type: "high_severity_ack", signer_name: "Owner Olly",
                signer_role: "owner", signer_statement: nil, # optional since ADR-0011
                image_s3_key: ack_sig_key[:s3_key], sha256: Digest::SHA256.hexdigest(png_bytes), signed_at: Time.current.iso8601 }
    post "/api/v1/inspections/#{inspection['id']}/signatures", params: { signature: ack_sig }, headers: auth(@tech_token), as: :json
    assert_response :created
    ack_signature_id = body["data"]["id"]

    event_payload = { client_generated_id: SecureRandom.uuid, inspection_item_id: high_item["client_generated_id"],
                      opened_at: Time.current.iso8601,
                      conversation_checklist: { item_identified_and_shown: true, photo_shown: true, recommendation_stated: true,
                                                decision_recorded: false, owner_initials: "OO" },
                      machine_out_of_service: true, owner_signature_id: ack_sig[:client_generated_id] }
    post "/api/v1/high_severity_events", params: { high_severity_event: event_payload }, headers: auth(@tech_token), as: :json
    assert_response :unprocessable_content, "every conversation step must be ticked"
    event_payload[:conversation_checklist][:decision_recorded] = true
    event_payload[:conversation_checklist][:owner_initials] = ""
    post "/api/v1/high_severity_events", params: { high_severity_event: event_payload }, headers: auth(@tech_token), as: :json
    assert_response :unprocessable_content, "owner initials are required"
    assert_match(/owner_initials/, body["details"].join)
    event_payload[:conversation_checklist][:owner_initials] = "OO"
    post "/api/v1/high_severity_events", params: { high_severity_event: event_payload }, headers: auth(@tech_token), as: :json
    assert_response :created
    assert_equal "OO", body["data"]["conversation_checklist"]["owner_initials"]
    event = body["data"]
    assert_equal ack_signature_id, event["owner_signature_id"]
    assert_nil event["resolved_at"]

    # 4. Checkout signature, lock, report.
    checkout = { client_generated_id: SecureRandom.uuid, signature_type: "visit_checkout", signer_name: "Owner Olly",
                 signer_role: "owner", signer_statement: "Walked the yard with Terry.", signed_at: Time.current.iso8601 }
    post "/api/v1/inspections/#{inspection['id']}/signatures", params: { signature: checkout }, headers: auth(@tech_token), as: :json
    assert_response :created
    post "/api/v1/inspections/#{inspection['id']}/lock", params: { locked_at: Time.current.iso8601 }, headers: auth(@tech_token), as: :json
    assert_response :ok
    assert_equal "locked", body["data"]["status"]
    assert body["data"]["locked_at"].present?
    report = body["data"]["report"]
    assert report["sha256"].match?(/\A[0-9a-f]{64}\z/)
    assert report["page_count"] >= 2
    rendered_tiers = ReportGenerator.new(Inspection.find(inspection["id"])).send(:grouped_items).keys.sort
    assert_equal %w[high low], rendered_tiers, "no Medium items, so the Medium page is omitted entirely"

    get "/api/v1/inspections/#{inspection['id']}/report", headers: auth(@tech_token)
    assert_response :ok
    assert_equal "application/pdf", response.media_type
    assert response.body.start_with?("%PDF")
    assert_equal report["sha256"], Digest::SHA256.hexdigest(response.body)

    # 5. Locked: every write endpoint returns 409, and photos are confirmed only if the server has the bytes.
    post "/api/v1/inspections/#{inspection['id']}/items", params: { items: [items.first.merge(client_generated_id: SecureRandom.uuid, position: 500)] },
                                                           headers: auth(@tech_token), as: :json
    assert_response :conflict
    post "/api/v1/inspections/#{inspection['id']}/signatures", params: { signature: checkout.merge(client_generated_id: SecureRandom.uuid) },
                                                                headers: auth(@tech_token), as: :json
    assert_response :conflict
    post "/api/v1/photos/presign", params: { purpose: "photo", inspection_item_id: server_items.first["id"], client_generated_id: SecureRandom.uuid },
                                   headers: auth(@tech_token), as: :json
    assert_response :conflict
    post "/api/v1/inspections/#{inspection['id']}/lock", headers: auth(@tech_token), as: :json
    assert_response :conflict
    # Retrying an already confirmed photo after lock is still idempotent (200), so the device can safely finish its queue.
    first_photo = Photo.find_by!(inspection_item_id: server_items.first["id"])
    post "/api/v1/photos/confirm", params: { s3_key: first_photo.s3_key, sha256: first_photo.sha256, inspection_item_id: first_photo.inspection_item_id,
                                             client_generated_id: first_photo.client_generated_id, captured_at: first_photo.captured_at.iso8601 },
                                   headers: auth(@tech_token), as: :json
    assert_response :ok
    assert body["existing"]

    # 7. Append a note to the locked inspection; editing is impossible (no endpoint, and the DB forbids it).
    post "/api/v1/inspections/#{inspection['id']}/notes", params: { note: { client_generated_id: SecureRandom.uuid, body: "Tech missed the rear left stem cap." } },
                                                           headers: auth(@admin_token), as: :json
    assert_response :created
    assert_equal "admin", body["data"]["author_role"]
    get "/api/v1/inspections/#{inspection['id']}/notes", headers: auth(@tech_token)
    assert_equal 1, body["data"].size

    # 6. Next visit: the open High event is in the machine history and must be rechecked with a carried-forward item.
    get "/api/v1/machines/#{machine['id']}/history", headers: auth(@tech_token)
    assert_response :ok
    history = body["data"]
    assert_equal 1, history["open_high_severity_events"].size
    assert_equal high_item["id"], history["open_high_severity_events"].first["inspection_item_id"]
    assert_equal 1, history["inspections"].size
    assert history["photos"].size >= template_items.size - optional_keys.size - 1, "one photo per required item (one item was skipped)"
    assert history["inspections"].first["report_available"]

    second = { client_generated_id: SecureRandom.uuid, machine_id: machine["id"], inspection_type: "walkthrough",
               performed_at: Time.current.iso8601, hour_meter_reading: 1230 }
    post "/api/v1/inspections", params: { inspection: second }, headers: auth(@tech_token), as: :json
    assert_response :created
    second_id = body["data"]["id"]
    recheck = { client_generated_id: SecureRandom.uuid, template_item_key: high_item["template_item_key"], position: 0,
                component_name: high_item["component_name"], result_type: "tiered", severity: "low",
                carried_forward_from_item_id: high_item["id"], technician_note: "Hose replaced, dry after 10 min under load" }
    post "/api/v1/inspections/#{second_id}/items", params: { items: [recheck] }, headers: auth(@tech_token), as: :json
    assert_response :ok
    assert_equal high_item["id"], body["data"].first["carried_forward_from_item_id"]
    upload_photo!(body["data"].first, "fresh photo of replaced hose")

    # Plain technician cannot resolve; senior technician can.
    post "/api/v1/high_severity_events/#{event['id']}/resolve", params: { inspection_id: second_id, resolution_note: "replaced" },
                                                                 headers: auth(@tech_token), as: :json
    assert_response :forbidden
    post "/api/v1/high_severity_events/#{event['id']}/resolve", params: { inspection_id: second_id, resolution_note: "Hose replaced by owner's mechanic; verified dry." },
                                                                 headers: auth(@senior_token), as: :json
    assert_response :ok
    assert body["data"]["resolved_at"].present?
    assert_equal second_id, body["data"]["resolved_in_inspection_id"]
    get "/api/v1/machines/#{machine['id']}/history", headers: auth(@tech_token)
    assert_equal 0, body["data"]["open_high_severity_events"].size
    assert_equal 1, body["data"]["resolved_high_severity_events"].size, "resolved events never disappear from history"

    # 10. Discrepancy: a second technician inspecting the same machine on the same day is recorded, never merged.
    third = { client_generated_id: SecureRandom.uuid, machine_id: machine["id"], inspection_type: "walkthrough",
              performed_at: Time.current.iso8601, hour_meter_reading: 1231 }
    post "/api/v1/inspections", params: { inspection: third }, headers: auth(@senior_token), as: :json
    assert_response :created
    assert_equal 1, body["discrepancy_alert_ids"].size
    get "/api/v1/discrepancy_alerts", headers: auth(@tech_token)
    assert_response :forbidden
    get "/api/v1/discrepancy_alerts", headers: auth(@admin_token)
    assert_response :ok
    assert_equal 1, body["data"].size
    assert_equal [second_id, body["data"].first["inspection_b"]["id"]].sort,
                 [body["data"].first["inspection_a"]["id"], body["data"].first["inspection_b"]["id"]].sort
    assert_equal 3, Inspection.where(machine_id: machine["id"]).count
  end

  test "machine sale keeps history with the machine; old inspections keep their customer snapshot" do
    machine = create_machine(customer: @customer)
    insp = create_inspection(machine: machine, technician: @tech)
    buyer = create_customer(name: "Buyer Co")
    patch "/api/v1/machines/#{machine.id}", params: { machine: { customer_id: buyer.id } }, headers: auth(@admin_token), as: :json
    assert_response :ok
    assert_equal buyer.id, machine.reload.customer_id
    assert_equal @customer.id, insp.reload.customer_id
    get "/api/v1/machines/#{machine.id}/history", headers: auth(@admin_token)
    assert_equal 1, body["data"]["inspections"].size
  end

  test "retagging updates the same machine and records tag history" do
    machine = create_machine(customer: @customer, nfc_tag_id: "OLDTAG")
    post "/api/v1/machines/#{machine.id}/retag", params: { nfc_tag_id: "NEWTAG" }, headers: auth(@senior_token), as: :json
    assert_response :ok
    assert_equal "NEWTAG", machine.reload.nfc_tag_id
    assert_equal 1, Machine.where(serial_number: machine.serial_number).count
    get "/api/v1/machines/lookup", params: { nfc: "NEWTAG" }, headers: auth(@tech_token)
    assert_equal machine.id, body["data"]["id"]
    assert_equal 1, machine.nfc_tag_histories.count
  end

  test "reference data pull and template pull" do
    create_machine(customer: @customer)
    get "/api/v1/customers", headers: auth(@tech_token)
    assert_equal [@customer.id], body["data"].map { |c| c["id"] }
    get "/api/v1/machines", headers: auth(@stranger_token)
    assert_equal [], body["data"]
    get "/api/v1/checklist_templates", params: { since: 1.minute.from_now.iso8601 }, headers: auth(@tech_token)
    assert_equal [], body["data"]
    get "/api/v1/checklist_templates", headers: auth(@tech_token)
    assert_equal 5, body["data"].size
    assert body["data"].all? { |t| t["published_at"].present? }
  end

  test "unauthenticated and revoked tokens are rejected" do
    get "/api/v1/me"
    assert_response :unauthorized
    delete "/api/v1/auth/logout", headers: auth(@tech_token)
    assert_response :no_content
    get "/api/v1/me", headers: auth(@tech_token)
    assert_response :unauthorized
  end

  private

  def body
    JSON.parse(response.body)
  end

  def login(user, password)
    post "/api/v1/auth/login", params: { email: user.email, password: password, device_id: "ipad-test" }, as: :json
    assert_response :created
    body["token"]
  end

  def auth(token, device_time: nil)
    h = { "Authorization" => "Bearer #{token}", "X-Device-Id" => "ipad-test" }
    h["X-Device-Time"] = device_time.iso8601 if device_time
    h
  end

  def presign!(item)
    client_id = SecureRandom.uuid
    post "/api/v1/photos/presign", params: { purpose: "photo", inspection_item_id: item["id"], client_generated_id: client_id,
                                             content_type: "image/jpeg" }, headers: auth(@tech_token), as: :json
    assert_response :ok
    { upload_url: body["upload_url"], s3_key: body["s3_key"], client_id: client_id }
  end

  def presign_signature!(inspection_id)
    client_id = SecureRandom.uuid
    post "/api/v1/photos/presign", params: { purpose: "signature", inspection_id: inspection_id, client_generated_id: client_id },
                                   headers: auth(@tech_token), as: :json
    assert_response :ok
    { upload_url: body["upload_url"], s3_key: body["s3_key"], client_id: client_id }
  end

  def upload_photo!(item, bytes)
    p = presign!(item)
    put p[:upload_url], params: bytes, headers: { "Content-Type" => "image/jpeg" }
    assert_response :ok
    post "/api/v1/photos/confirm", params: { s3_key: p[:s3_key], sha256: Digest::SHA256.hexdigest(bytes), inspection_item_id: item["id"],
                                             client_generated_id: p[:client_id], captured_at: Time.current.iso8601, byte_size: bytes.bytesize },
                                   headers: auth(@tech_token), as: :json
    assert_response :created
    body["data"]
  end
end
