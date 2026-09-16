# frozen_string_literal: true

class ConsumableRecord < ApplicationRecord
  enum :consumable_type, %w[fuel_filter air_filter hydraulic_filter cabin_filter engine_oil hydraulic_oil
                            belt_pto belt_ac belt_alternator other].index_by(&:itself)
  enum :source, { uptime_changed: "uptime_changed", date_read_from_part: "date_read_from_part", unknown: "unknown" }

  belongs_to :machine
  belongs_to :inspection, optional: true

  validates :consumable_type, :source, presence: true

  # LATER: overdue computation. `unknown` sources cannot compute overdue.
  def overdue_computable?
    !unknown? && (changed_at.present? || hour_meter_at_change.present?)
  end
end
