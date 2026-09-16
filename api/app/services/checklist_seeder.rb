# frozen_string_literal: true

require "yaml"

# Loads db/seeds/checklists/*.yml, merges _shared_criteria.yml into every item
# that references it, and creates + publishes one template per file. Idempotent:
# an existing (machine_class, drive_type, has_def, version) row is left alone
# because published templates are immutable.
class ChecklistSeeder
  SEED_DIR = Rails.root.join("db/seeds/checklists")

  Result = Struct.new(:template, :created)

  def self.run(dir: SEED_DIR, publish: true, logger: Rails.logger)
    new(dir, publish: publish, logger: logger).run
  end

  def initialize(dir, publish:, logger:)
    @dir = Pathname(dir)
    @publish = publish
    @logger = logger
  end

  def run
    shared = YAML.safe_load_file(@dir.join("_shared_criteria.yml")).fetch("criteria")
    @dir.glob("*.yml").reject { |p| p.basename.to_s.start_with?("_") }.sort.map do |path|
      seed_file(path, shared)
    end
  end

  def seed_file(path, shared)
    doc = YAML.safe_load_file(path)
    items = doc.fetch("items").map { |item| merge_item(item, shared, path) }
    attrs = {
      machine_class: doc.fetch("machine_class"),
      drive_type: doc["drive_type"],
      has_def: doc["has_def"],
      version: doc.fetch("version")
    }
    existing = ChecklistTemplate.find_by(attrs)
    if existing
      @logger.info("checklist #{attrs[:machine_class]} #{attrs[:version]} already seeded (#{existing.id})")
      return Result.new(existing, false)
    end
    template = ChecklistTemplate.create!(attrs.merge(items: items))
    template.publish! if @publish
    @logger.info("seeded checklist #{attrs[:machine_class]} #{attrs[:version]} with #{items.size} items")
    Result.new(template, true)
  end

  private

  # Output shape is exactly spec 4.3 plus the extra descriptive fields carried
  # from the workbook (cadence_label, check_method_label, walkthrough_group,
  # applies_when, pass_fail_criteria, criteria_ref for traceability).
  def merge_item(item, shared, path)
    out = item.dup
    if (ref = item["criteria_ref"])
      crit = shared[ref] or raise "#{path}: item #{item['key']} references unknown shared criteria '#{ref}'"
      out["tier_criteria"] = { "low" => crit["low"], "medium" => crit["medium"], "high" => crit["high"] }
    elsif item["result_type"] == "pass_fail"
      pf = item["pass_fail_criteria"] || {}
      out["tier_criteria"] ||= { "low" => pf["pass"], "medium" => nil, "high" => pf["fail"] }
    end
    out["photo_required"] = item.fetch("photo_required", true) == true
    out["default_if_ambiguous"] = "round_up"
    out["measurement"] ||= nil
    out["notes_to_tech"] ||= nil
    out
  end
end
