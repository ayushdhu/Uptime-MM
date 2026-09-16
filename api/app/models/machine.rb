# frozen_string_literal: true

# machines.id is the Unique Machine ID. It never changes for the life of the
# machine. History belongs to the machine, not the customer.
class Machine < ApplicationRecord
  enum :machine_class, ChecklistTemplate::MACHINE_CLASSES.index_by(&:itself)
  enum :drive_type, { wheeled: "wheeled", tracked: "tracked" }
  enum :emissions_tier, { tier_3: "tier_3", tier_4: "tier_4" }

  belongs_to :customer
  belongs_to :checklist_template
  has_many :inspections, dependent: :restrict_with_exception
  has_many :nfc_tag_histories, class_name: "NfcTagHistory", dependent: :restrict_with_exception
  has_many :high_severity_events, dependent: :restrict_with_exception
  has_many :consumable_records, dependent: :restrict_with_exception
  has_many :discrepancy_alerts, dependent: :restrict_with_exception

  validates :serial_number, presence: true, uniqueness: { case_sensitive: false }
  validates :nfc_tag_id, uniqueness: true, allow_nil: true
  validates :machine_class, :drive_type, presence: true
  validates :year, numericality: { only_integer: true, greater_than: 1900, less_than: 2100 }, allow_nil: true
  validates :current_hour_meter, :estimated_hours_per_week,
            numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true

  before_validation :normalize_identifiers
  before_validation :derive_emissions_tier

  scope :active, -> { where(active: true) }
  scope :for_customers, ->(ids) { where(customer_id: ids) }
  scope :updated_since, ->(ts) { ts ? where("machines.updated_at > ?", ts) : all }

  # year > 2010 and DEF cap present => Tier 4, else Tier 3.
  def self.derive_emissions_tier(year:, has_def:)
    year.to_i > 2010 && has_def ? "tier_4" : "tier_3"
  end

  # Always derivable, even on an unsaved wizard payload.
  def emissions_tier
    super || self.class.derive_emissions_tier(year: year, has_def: has_def)
  end

  def open_high_severity_events
    high_severity_events.open.includes(inspection_item: { inspection: :technician, photos: [] })
  end

  # Re-tagging updates the existing row and records the change. Never creates a
  # new machine.
  def retag!(new_tag_id, by:)
    transaction do
      nfc_tag_histories.where(removed_at: nil).update_all(removed_at: Time.current)
      update!(nfc_tag_id: new_tag_id.presence)
      nfc_tag_histories.create!(nfc_tag_id: new_tag_id, assigned_at: Time.current, assigned_by_user: by) if new_tag_id.present?
    end
    self
  end

  def checklist_items
    checklist_template.items_for(self)
  end

  private

  def normalize_identifiers
    self.serial_number = serial_number.to_s.strip.upcase if serial_number
    self.nfc_tag_id = nfc_tag_id.to_s.strip.presence if nfc_tag_id
  end

  def derive_emissions_tier
    self.emissions_tier = self.class.derive_emissions_tier(year: year, has_def: has_def)
  end
end
