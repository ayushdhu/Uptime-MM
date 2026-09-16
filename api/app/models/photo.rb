# frozen_string_literal: true

# Metadata only. Image bytes live in object storage.
class Photo < ApplicationRecord
  include LockedInspectionGuard

  SHA256_FORMAT = /\A[0-9a-f]{64}\z/

  enum :retention_state, { full: "full", thumbnail_only: "thumbnail_only" }

  belongs_to :inspection_item
  has_one :inspection, through: :inspection_item

  validates :s3_key, :sha256, :captured_at, :client_generated_id, presence: true
  validates :sha256, format: { with: SHA256_FORMAT }
  validates :s3_key, uniqueness: true
  validates :client_generated_id, uniqueness: true

  before_validation { self.sha256 = sha256.to_s.downcase }

  def guarded_inspection
    inspection_item&.inspection
  end

  # Upload bookkeeping is permitted after lock, via the dedicated function.
  def mark_uploaded!(at: Time.current, thumbnail_key: nil)
    self.class.connection.execute(
      self.class.sanitize_sql_array(["SELECT uptime_mark_photo_uploaded(?, ?, ?)", id, at.utc, thumbnail_key])
    )
    reload
  end
end
