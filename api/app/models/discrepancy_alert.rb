# frozen_string_literal: true

# Two technicians inspected the same machine on the same calendar day (spec 10).
class DiscrepancyAlert < ApplicationRecord
  belongs_to :machine
  belongs_to :inspection_a, class_name: "Inspection"
  belongs_to :inspection_b, class_name: "Inspection"
  belongs_to :reviewed_by_user, class_name: "User", optional: true

  scope :unreviewed, -> { where(reviewed_at: nil) }

  # Called after an inspection is created. Records (never merges) both rows.
  def self.record_for!(inspection)
    day = inspection.performed_at.to_date
    others = Inspection.where(machine_id: inspection.machine_id)
                       .where.not(id: inspection.id)
                       .where.not(technician_id: inspection.technician_id)
                       .where(performed_at: day.beginning_of_day..day.end_of_day)
    others.map do |other|
      a, b = [other, inspection].sort_by(&:performed_at)
      find_or_create_by!(inspection_a: a, inspection_b: b) { |al| al.machine_id = inspection.machine_id }
    end
  end
end
