# frozen_string_literal: true

class Signature < ApplicationRecord
  include LockedInspectionGuard

  enum :signature_type, { visit_checkout: "visit_checkout", high_severity_ack: "high_severity_ack" }

  belongs_to :inspection
  has_many :high_severity_events, foreign_key: :owner_signature_id, inverse_of: :owner_signature,
                                  dependent: :restrict_with_exception

  validates :signer_name, :signed_at, :client_generated_id, presence: true
  validates :client_generated_id, uniqueness: true
  validates :sha256, format: { with: Photo::SHA256_FORMAT }, allow_nil: true
end
