# frozen_string_literal: true

# Versioned checklist. Immutable once published: a change is a new row with a
# new version. `items` is the ordered JSON array described in spec 4.3, with
# shared criteria already merged in at seed time.
class ChecklistTemplate < ApplicationRecord
  MACHINE_CLASSES = %w[skid_steer wheel_loader excavator dozer farm_tractor].freeze
  RESULT_TYPES = %w[tiered pass_fail measurement].freeze
  CHECK_METHODS = %w[visual physical fluid_level measurement function].freeze
  CADENCES = %w[weekly monthly].freeze

  enum :machine_class, MACHINE_CLASSES.index_by(&:itself)
  enum :drive_type, { wheeled: "wheeled", tracked: "tracked" }, prefix: true

  has_many :machines, dependent: :restrict_with_exception
  has_many :inspections, dependent: :restrict_with_exception

  validates :version, presence: true,
                      uniqueness: { scope: %i[machine_class drive_type has_def], message: "already exists for this variant" }
  validate :items_are_well_formed
  validate :immutable_once_published, on: :update

  scope :published, -> { where.not(published_at: nil) }
  scope :updated_since, ->(ts) { ts ? where("updated_at > ?", ts) : all }

  def published?
    published_at.present?
  end

  def publish!
    raise ActiveRecord::RecordInvalid, self if published?
    update!(published_at: Time.current)
  end

  # The setup wizard picks the highest published version matching
  # (machine_class, drive_type, has_def). A template with NULL drive_type or
  # NULL has_def applies to both; a specific match outranks a wildcard at the
  # same version.
  def self.select_for(machine_class:, drive_type:, has_def:)
    candidates = published.where(machine_class: machine_class)
                          .where(drive_type: [drive_type, nil])
                          .where(has_def: [has_def, nil])
    candidates.max_by { |t| [version_sort_key(t.version), t.drive_type.nil? ? 0 : 1, t.has_def.nil? ? 0 : 1] }
  end

  # "alpha-2" < "v1" < "v2" < "v10". Natural sort on (stage, number).
  def self.version_sort_key(version)
    stage, num = version.to_s.match(/\A([a-z]*)-?(\d+)\z/i)&.captures || [version.to_s, 0]
    stage_rank = { "alpha" => 0, "beta" => 1, "rc" => 2, "v" => 3 }.fetch(stage.downcase, 3)
    [stage_rank, num.to_i]
  end

  # Items that apply to a specific machine (drops conditional items whose
  # `applies_when` does not match).
  def items_for(machine)
    items.select { |item| item_applies?(item, machine) }
  end

  def item_applies?(item, machine)
    cond = item["applies_when"]
    return true if cond.blank?
    cond.all? do |attr, expected|
      actual = machine.public_send(attr)
      actual == expected || actual.to_s == expected.to_s
    end
  end

  def find_item(key)
    items.find { |i| i["key"] == key }
  end

  private

  def items_are_well_formed
    unless items.is_a?(Array) && items.any?
      errors.add(:items, "must be a non-empty array")
      return
    end
    keys = []
    items.each_with_index do |item, idx|
      %w[key component section cadence check_method result_type].each do |f|
        errors.add(:items, "item #{idx} missing #{f}") if item[f].blank?
      end
      errors.add(:items, "item #{idx} has invalid result_type") unless RESULT_TYPES.include?(item["result_type"])
      errors.add(:items, "item #{idx} has invalid check_method") unless CHECK_METHODS.include?(item["check_method"])
      errors.add(:items, "item #{idx} has invalid cadence") unless CADENCES.include?(item["cadence"])
      errors.add(:items, "item #{idx} default_if_ambiguous must be round_up") unless item["default_if_ambiguous"] == "round_up"
      errors.add(:items, "item #{idx} photo_required must be true or false") unless [true, false].include?(item["photo_required"])
      if item["result_type"] != "pass_fail" && item["tier_criteria"].blank?
        errors.add(:items, "item #{idx} (#{item['key']}) needs tier_criteria (shared criteria must be merged at seed time)")
      end
      errors.add(:items, "duplicate key #{item['key']}") if keys.include?(item["key"])
      keys << item["key"]
    end
  end

  def immutable_once_published
    return unless published_at_was.present?
    changed_fields = changes.keys - %w[updated_at]
    errors.add(:base, "published templates are immutable; create a new version") if changed_fields.any?
  end
end
