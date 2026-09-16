# frozen_string_literal: true

require "test_helper"

class LockRulesTest < ActiveSupport::TestCase
  setup do
    @customer = create_customer
    @tech = create_user
    assign(@tech, @customer)
    @machine = create_machine(customer: @customer)
    @inspection = create_inspection(machine: @machine, technician: @tech)
  end

  test "an item whose template marks photo_required false does not block locking without a photo" do
    optional = @machine.checklist_items.find { |i| !i["photo_required"] }
    required = @machine.checklist_items.find { |i| i["photo_required"] && i["result_type"] == "tiered" }
    create_item(inspection: @inspection, key: optional["key"], result_type: "pass_fail", component_name: optional["component"])
    with_photo = create_item(inspection: @inspection, key: required["key"], component_name: required["component"])
    create_signature(inspection: @inspection)
    assert_includes @inspection.lockable_errors.join, "missing a required photo"
    assert_includes @inspection.lockable_errors.join, required["component"]
    create_photo(item: with_photo)
    assert_equal [], @inspection.lockable_errors
    @inspection.lock!
    assert @inspection.locked?
  end

  test "a carried-forward recheck always needs a fresh photo, even for a photo-optional item" do
    optional = @machine.checklist_items.find { |i| !i["photo_required"] }
    original = create_item(inspection: @inspection, key: optional["key"], result_type: "pass_fail")
    later = create_inspection(machine: @machine, technician: @tech)
    create_item(inspection: later, key: optional["key"], result_type: "pass_fail", carried_forward_from_item_id: original.id)
    create_signature(inspection: later)
    assert_includes later.lockable_errors.join, "missing a required photo"
  end

  test "lock errors are specific and countable" do
    3.times { create_item(inspection: @inspection) }
    errs = @inspection.lockable_errors
    assert_includes errs.join, "3 item(s) missing a required photo"
    assert_includes errs.join, "no checkout signature"
  end

  test "a High severity event needs owner initials but no statement" do
    item = create_item(inspection: @inspection, severity: "high")
    create_photo(item: item)
    ack = create_signature(inspection: @inspection, signature_type: "high_severity_ack", signer_statement: nil)
    base = { inspection_item: item, machine: @machine, opened_at: Time.current, machine_out_of_service: true,
             owner_signature: ack, client_generated_id: SecureRandom.uuid }
    without = HighSeverityEvent.new(base.merge(conversation_checklist: HighSeverityEvent::CONVERSATION_STEPS.index_with { true }))
    assert_not without.valid?
    assert_match(/owner_initials/, without.errors.full_messages.join)
    with = HighSeverityEvent.new(base.merge(conversation_checklist: HighSeverityEvent::CONVERSATION_STEPS.index_with { true }.merge("owner_initials" => "jd")))
    assert with.valid?, with.errors.full_messages.join
    assert_equal "jd", with.owner_initials
  end
end
