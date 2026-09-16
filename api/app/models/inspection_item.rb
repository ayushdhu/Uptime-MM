# frozen_string_literal: true

class InspectionItem < ApplicationRecord
  include LockedInspectionGuard

  enum :result_type, { tiered: "tiered", pass_fail: "pass_fail", measurement: "measurement" }
  enum :severity, { low: "low", medium: "medium", high: "high" }, validate: { allow_nil: true }

  belongs_to :inspection, inverse_of: :items
  belongs_to :carried_forward_from_item, class_name: "InspectionItem", optional: true
  has_many :photos, dependent: :restrict_with_exception
  has_many :notes, class_name: "InspectionNote", dependent: :restrict_with_exception
  has_one :high_severity_event, dependent: :restrict_with_exception

  validates :template_item_key, :component_name, :position, :client_generated_id, presence: true
  validates :client_generated_id, uniqueness: true
  validates :position, uniqueness: { scope: :inspection_id }
  validates :skip_reason, presence: { message: "must be given when an item is skipped" }, if: :skipped?
  validate :result_matches_type

  scope :highs, -> { where(severity: "high", skipped: false) }

  def carried_forward?
    carried_forward_from_item_id.present?
  end

  def resulted?
    skipped? || severity.present? || !pass.nil? || measurement_value.present?
  end

  private

  def result_matches_type
    return if skipped?
    case result_type
    when "tiered"
      errors.add(:severity, "is required for tiered items") if severity.blank?
      errors.add(:pass, "does not apply to tiered items") unless pass.nil?
    when "pass_fail"
      errors.add(:pass, "is required for pass/fail items") if pass.nil?
      errors.add(:severity, "does not apply to pass/fail items") if severity.present?
    when "measurement"
      errors.add(:measurement_value, "is required for measurement items") if measurement_value.nil? && measurement_detail.blank?
    end
  end
end
