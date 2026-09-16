# frozen_string_literal: true

# A High finding is a conversation, not a notification (spec 6).
class HighSeverityEvent < ApplicationRecord
  CONVERSATION_STEPS = %w[
    item_identified_and_shown
    photo_shown
    recommendation_stated
    decision_recorded
  ].freeze

  belongs_to :inspection_item
  belongs_to :machine
  belongs_to :owner_signature, class_name: "Signature"
  belongs_to :resolved_by_user, class_name: "User", optional: true
  belongs_to :resolved_in_inspection, class_name: "Inspection", optional: true
  has_one :inspection, through: :inspection_item

  validates :opened_at, :client_generated_id, presence: true
  validates :client_generated_id, uniqueness: true
  validates :machine_out_of_service, inclusion: { in: [true, false] }
  validates :recheck_interval_days, presence: true, numericality: { only_integer: true, greater_than: 0 },
                                    unless: :machine_out_of_service
  validates :repair_plan, presence: true, unless: :machine_out_of_service
  validate :conversation_checklist_complete
  validate :owner_initials_present
  validate :item_is_high
  validate :signature_is_high_ack

  # ADR-0011: the owner initials the acknowledgment; the free text statement is optional.
  def owner_initials
    conversation_checklist.is_a?(Hash) ? conversation_checklist["owner_initials"].to_s.strip : ""
  end

  scope :open, -> { where(resolved_at: nil) }
  scope :resolved, -> { where.not(resolved_at: nil) }

  def open?
    resolved_at.nil?
  end

  def resolve!(by:, in_inspection:, note:)
    raise ActiveRecord::RecordInvalid, self unless open?
    update!(resolved_at: Time.current, resolved_by_user: by, resolved_in_inspection: in_inspection, resolution_note: note)
  end

  private

  def conversation_checklist_complete
    missing = CONVERSATION_STEPS.reject { |s| conversation_checklist.is_a?(Hash) && conversation_checklist[s] == true }
    errors.add(:conversation_checklist, "incomplete: #{missing.join(', ')}") if missing.any?
  end

  def owner_initials_present
    errors.add(:conversation_checklist, "owner_initials required (1 to 6 characters)") unless owner_initials.length.between?(1, 6)
  end

  def item_is_high
    return unless inspection_item
    errors.add(:inspection_item, "must be graded High") unless inspection_item.severity == "high"
    self.machine_id ||= inspection_item.inspection&.machine_id
  end

  def signature_is_high_ack
    return unless owner_signature
    errors.add(:owner_signature, "must be a high_severity_ack signature") unless owner_signature.high_severity_ack?
    if inspection_item && owner_signature.inspection_id != inspection_item.inspection_id
      errors.add(:owner_signature, "must belong to the same inspection")
    end
  end
end
