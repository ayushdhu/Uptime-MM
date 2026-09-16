# frozen_string_literal: true

class Inspection < ApplicationRecord
  enum :inspection_type, { walkthrough: "walkthrough", pm_100hr: "pm_100hr", baseline: "baseline" }
  enum :status, { in_progress: "in_progress", completed: "completed", locked: "locked" }

  belongs_to :machine
  belongs_to :customer
  belongs_to :technician, class_name: "User"
  belongs_to :checklist_template

  has_many :items, -> { order(:position) }, class_name: "InspectionItem", dependent: :restrict_with_exception,
                                            inverse_of: :inspection
  has_many :photos, through: :items
  has_many :signatures, dependent: :restrict_with_exception
  has_many :notes, class_name: "InspectionNote", dependent: :restrict_with_exception
  has_many :high_severity_events, through: :items
  has_many :resolved_high_severity_events, class_name: "HighSeverityEvent", foreign_key: :resolved_in_inspection_id,
                                            inverse_of: :resolved_in_inspection, dependent: :nullify
  has_one :report, class_name: "InspectionReport", dependent: :restrict_with_exception

  validates :performed_at, :hour_meter_reading, :checklist_version, :client_generated_id, presence: true
  validates :client_generated_id, uniqueness: true
  validates :hour_meter_reading, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :customer_matches_machine_on_create, on: :create

  before_validation :snapshot_from_machine, on: :create

  scope :recent_first, -> { order(performed_at: :desc) }
  scope :for_customers, ->(ids) { where(customer_id: ids) }

  # Once locked, the row is immutable except for synced_at (via SQL function).
  def readonly?
    super || (persisted? && status_was == "locked")
  end

  before_destroy prepend: true do
    raise ActiveRecord::ReadOnlyRecord, "inspection #{id} is locked" if readonly?
  end

  def lock!(at: Time.current)
    raise ActiveRecord::RecordInvalid, self if locked?
    self.completed_at ||= at
    self.locked_at = at
    self.status = "locked"
    save!
  end

  # The only permitted post-lock write, routed through the dedicated function.
  def mark_synced!(at = Time.current)
    self.class.connection.execute(
      self.class.sanitize_sql_array(["SELECT uptime_mark_inspection_synced(?, ?)", id, at.utc])
    )
    reload
  end

  def tier_counts
    items.unscope(:order).where(skipped: false).group(:severity).count.transform_keys { |k| k || "none" }
  end

  def high_items
    items.where(severity: "high", skipped: false)
  end

  def unresolved_high_items_without_events
    high_items.left_outer_joins(:high_severity_event).where(high_severity_events: { id: nil })
  end

  # Every High item must have a signed high_severity_event and the visit must
  # be signed off before the inspection can lock (spec 5.4 and 6).
  # Specific, readable reasons: the device shows these to the technician.
  def lockable_errors
    errs = []
    unresulted = items.where(skipped: false, severity: nil, pass: nil).where(result_type: %w[tiered pass_fail])
    errs << "#{unresulted.count} item(s) have no result and were not skipped" if unresulted.exists?
    missing = items_missing_photos
    errs << "#{missing.count} item(s) missing a required photo: #{missing.limit(5).pluck(:component_name).join(', ')}" if missing.exists?
    highs = unresolved_high_items_without_events
    errs << "#{highs.count} High item(s) without a signed High severity acknowledgment" if highs.exists?
    errs << "no checkout signature" unless signatures.visit_checkout.exists?
    errs
  end

  # Photo required per template item (`photo_required`), not universally. A
  # carried-forward recheck always needs a fresh photo (spec 6).
  def items_missing_photos
    optional_keys = checklist_template.items.reject { |i| i["photo_required"] }.map { |i| i["key"] }
    scope = items.where(skipped: false).left_outer_joins(:photos).where(photos: { id: nil })
    scope.where(carried_forward_from_item_id: nil).where.not(template_item_key: optional_keys)
         .or(scope.where.not(carried_forward_from_item_id: nil))
  end

  private

  def snapshot_from_machine
    return unless machine
    self.customer_id ||= machine.customer_id
    self.checklist_template ||= machine.checklist_template
    self.checklist_version ||= checklist_template&.version
  end

  def customer_matches_machine_on_create
    return unless machine && customer_id
    errors.add(:customer_id, "must match the machine's owner at inspection time") if customer_id != machine.customer_id
  end
end
