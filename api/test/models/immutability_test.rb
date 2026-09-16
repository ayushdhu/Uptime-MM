# frozen_string_literal: true

require "test_helper"

class ImmutabilityTest < ActiveSupport::TestCase
  setup do
    @customer = create_customer
    @tech = create_user
    assign(@tech, @customer)
    @machine = create_machine(customer: @customer)
    @inspection = create_inspection(machine: @machine, technician: @tech)
    @item = create_item(inspection: @inspection)
    @photo = create_photo(item: @item)
    @sig = create_signature(inspection: @inspection)
    @inspection.lock!
  end

  test "ORM refuses to update or destroy a locked inspection" do
    assert @inspection.readonly?
    assert_raises(ActiveRecord::ReadOnlyRecord) { @inspection.update!(hour_meter_reading: 999) }
    assert_raises(ActiveRecord::ReadOnlyRecord) { @inspection.destroy! }
  end

  test "ORM refuses to change child rows of a locked inspection" do
    assert_raises(ActiveRecord::ReadOnlyRecord) { @item.update!(severity: "high") }
    assert_raises(ActiveRecord::ReadOnlyRecord) { @photo.update!(sha256: "0" * 64) }
    assert_raises(ActiveRecord::ReadOnlyRecord) { @sig.update!(signer_name: "Someone else") }
    assert_raises(ActiveRecord::ReadOnlyRecord) { @item.destroy! }
    assert_raises(ActiveRecord::ReadOnlyRecord) { create_item(inspection: @inspection) }
  end

  test "Postgres triggers reject raw SQL updates and deletes on locked chain" do
    conn = ActiveRecord::Base.connection
    q = ->(sql) { conn.execute(sql) }
    err = assert_raises(ActiveRecord::StatementInvalid) { q.("UPDATE inspections SET hour_meter_reading = 5 WHERE id = '#{@inspection.id}'") }
    assert_kind_of PG::IntegrityConstraintViolation, err.cause
    assert_raises(ActiveRecord::StatementInvalid) { q.("DELETE FROM inspections WHERE id = '#{@inspection.id}'") }
    assert_raises(ActiveRecord::StatementInvalid) { q.("UPDATE inspection_items SET severity = 'high' WHERE id = '#{@item.id}'") }
    assert_raises(ActiveRecord::StatementInvalid) { q.("DELETE FROM inspection_items WHERE id = '#{@item.id}'") }
    assert_raises(ActiveRecord::StatementInvalid) { q.("UPDATE photos SET sha256 = '#{'a' * 64}' WHERE id = '#{@photo.id}'") }
    assert_raises(ActiveRecord::StatementInvalid) { q.("DELETE FROM photos WHERE id = '#{@photo.id}'") }
    assert_raises(ActiveRecord::StatementInvalid) { q.("UPDATE signatures SET signer_name = 'x' WHERE id = '#{@sig.id}'") }
    assert_raises(ActiveRecord::StatementInvalid) { q.("DELETE FROM signatures WHERE id = '#{@sig.id}'") }
    assert_raises(ActiveRecord::StatementInvalid) do
      q.("INSERT INTO inspection_items (id, inspection_id, template_item_key, position, component_name, result_type, client_generated_id, created_at, updated_at)
          VALUES (gen_random_uuid(), '#{@inspection.id}', 'x', 99, 'x', 'tiered', gen_random_uuid(), now(), now())")
    end
  end

  test "only synced_at may change on a locked inspection, via the dedicated function" do
    t = 1.hour.ago.change(usec: 0)
    @inspection.mark_synced!(t)
    assert_equal t, @inspection.reload.synced_at
    # direct SQL touching synced_at only is tolerated by the trigger, anything else is not
    ActiveRecord::Base.connection.execute("UPDATE inspections SET synced_at = now() WHERE id = '#{@inspection.id}'")
    assert_raises(ActiveRecord::StatementInvalid) do
      ActiveRecord::Base.connection.execute("UPDATE inspections SET synced_at = now(), status = 'in_progress' WHERE id = '#{@inspection.id}'")
    end
  end

  test "photo upload bookkeeping is allowed after lock, content changes are not" do
    @photo.mark_uploaded!(thumbnail_key: "thumbs/x.jpg")
    assert_equal "thumbs/x.jpg", @photo.reload.thumbnail_s3_key
    ActiveRecord::Base.connection.execute("SELECT uptime_set_photo_retention('#{@photo.id}', 'thumbnail_only')")
    assert_equal "thumbnail_only", @photo.reload.retention_state
    assert_raises(ActiveRecord::StatementInvalid) do
      ActiveRecord::Base.connection.execute("UPDATE photos SET uploaded_at = now(), captured_at = now() WHERE id = '#{@photo.id}'")
    end
  end

  test "inspection notes are append only, even on a locked inspection" do
    note = InspectionNote.create!(inspection: @inspection, author_user: @tech, body: "The tech missed the left tire",
                                  client_generated_id: SecureRandom.uuid)
    assert_equal "technician", note.author_role
    assert note.readonly?
    assert_raises(ActiveRecord::ReadOnlyRecord) { note.update!(body: "edited") }
    assert_raises(ActiveRecord::ReadOnlyRecord) { note.destroy }
    assert_raises(ActiveRecord::StatementInvalid) do
      ActiveRecord::Base.connection.execute("UPDATE inspection_notes SET body = 'x' WHERE id = '#{note.id}'")
    end
    assert_raises(ActiveRecord::StatementInvalid) do
      ActiveRecord::Base.connection.execute("DELETE FROM inspection_notes WHERE id = '#{note.id}'")
    end
  end

  test "high severity events can still be resolved after the originating inspection is locked" do
    insp = create_inspection(machine: @machine, technician: @tech)
    item = create_item(inspection: insp, severity: "high")
    create_photo(item: item)
    ack = create_signature(inspection: insp, signature_type: "high_severity_ack")
    event = HighSeverityEvent.create!(inspection_item: item, machine: @machine, opened_at: Time.current,
                                      conversation_checklist: HighSeverityEvent::CONVERSATION_STEPS.index_with { true }.merge("owner_initials" => "OO"),
                                      machine_out_of_service: false, recheck_interval_days: 7, repair_plan: "replace hose",
                                      owner_signature: ack, client_generated_id: SecureRandom.uuid)
    create_signature(inspection: insp)
    insp.lock!
    later = create_inspection(machine: @machine, technician: @tech)
    event.resolve!(by: @tech, in_inspection: later, note: "hose replaced, verified dry")
    assert event.reload.resolved_at
    assert_equal later.id, event.resolved_in_inspection_id
    assert_equal 0, @machine.high_severity_events.open.count
  end
end
