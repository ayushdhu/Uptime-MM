# frozen_string_literal: true

require "test_helper"

class ChecklistTemplateTest < ActiveSupport::TestCase
  test "seeds one published alpha-2 template per machine class with shared criteria merged" do
    assert_equal 5, ChecklistTemplate.published.count
    skid = ChecklistTemplate.find_by!(machine_class: "skid_steer", version: "alpha-2")
    hose = skid.find_item("hydraulic_hoses_arm_aux_drive")
    assert_equal "hose", hose["criteria_ref"]
    assert_match(/Steady active leak/, hose["tier_criteria"]["high"])
    assert skid.items.all? { |i| [true, false].include?(i["photo_required"]) && i["default_if_ambiguous"] == "round_up" }
    assert_equal false, skid.find_item("backup_alarm")["photo_required"], "audible function test: no photo"
    assert_equal true, skid.find_item("seat_belt_condition_and_function")["photo_required"]
    assert skid.items.all? { |i| i["tier_criteria"].present? }
  end

  test "seeding is idempotent" do
    before = ChecklistTemplate.count
    ChecklistSeeder.run(logger: Logger.new(nil))
    assert_equal before, ChecklistTemplate.count
  end

  test "published templates are immutable; a change is a new version" do
    t = ChecklistTemplate.find_by!(machine_class: "dozer", version: "alpha-2")
    t.items = t.items.first(3)
    assert_not t.valid?
    assert_match(/immutable/, t.errors.full_messages.join)
    v3 = ChecklistTemplate.create!(machine_class: "dozer", version: "alpha-3", items: t.reload.items)
    assert_not v3.published?
    assert_equal "alpha-2", ChecklistTemplate.select_for(machine_class: "dozer", drive_type: "tracked", has_def: false).version
    v3.publish!
    assert_equal "alpha-3", ChecklistTemplate.select_for(machine_class: "dozer", drive_type: "tracked", has_def: false).version
  end

  test "version ordering treats v1 above alpha-9 and v10 above v2" do
    keys = %w[alpha-9 v1 v2 v10 beta-1].sort_by { |v| ChecklistTemplate.version_sort_key(v) }
    assert_equal %w[alpha-9 beta-1 v1 v2 v10], keys
  end

  test "specific variant outranks wildcard at the same version" do
    base = ChecklistTemplate.find_by!(machine_class: "excavator", version: "alpha-2")
    specific = ChecklistTemplate.create!(machine_class: "excavator", drive_type: "tracked", has_def: true, version: "alpha-2",
                                         items: base.items)
    specific.publish!
    assert_equal specific, ChecklistTemplate.select_for(machine_class: "excavator", drive_type: "tracked", has_def: true)
    assert_equal base, ChecklistTemplate.select_for(machine_class: "excavator", drive_type: "tracked", has_def: false)
  end

  test "items_for drops conditional items that do not apply to the machine" do
    skid = ChecklistTemplate.find_by!(machine_class: "skid_steer", version: "alpha-2")
    wheeled_t4 = Machine.new(drive_type: "wheeled", has_def: true, year: 2019)
    tracked_t3 = Machine.new(drive_type: "tracked", has_def: false, year: 2008)
    keys_w = skid.items_for(wheeled_t4).map { |i| i["key"] }
    keys_t = skid.items_for(tracked_t3).map { |i| i["key"] }
    assert_includes keys_w, "tires_wheeled_models_pressure_reading_each_tire"
    assert_not_includes keys_t, "tires_wheeled_models_pressure_reading_each_tire"
    assert_includes keys_t, "tracks_sprocket_teeth"
    assert_not_includes keys_w, "tracks_sprocket_teeth"
    assert_includes keys_t, "exhaust_carbon_clear_tier_3_or_older_only"
    assert_not_includes keys_w, "exhaust_carbon_clear_tier_3_or_older_only"
  end

  test "emissions tier derives from year and DEF cap" do
    assert_equal "tier_4", Machine.derive_emissions_tier(year: 2015, has_def: true)
    assert_equal "tier_3", Machine.derive_emissions_tier(year: 2015, has_def: false)
    assert_equal "tier_3", Machine.derive_emissions_tier(year: 2009, has_def: true)
  end
end
