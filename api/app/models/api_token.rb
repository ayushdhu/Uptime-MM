# frozen_string_literal: true

# Bearer token per (user, device). The raw token is shown once at login; only
# its SHA-256 digest is stored.
class ApiToken < ApplicationRecord
  belongs_to :user

  validates :device_id, :token_digest, presence: true

  scope :active, -> { where(revoked_at: nil) }

  def self.digest(raw)
    Digest::SHA256.hexdigest(raw)
  end

  def self.issue!(user:, device_id:)
    raw = SecureRandom.base58(48)
    token = create!(user: user, device_id: device_id, token_digest: digest(raw))
    [token, raw]
  end

  def self.authenticate(raw)
    return nil if raw.blank?
    token = active.includes(:user).find_by(token_digest: digest(raw))
    return nil unless token&.user&.active?
    token.update_column(:last_used_at, Time.current) if token.last_used_at.nil? || token.last_used_at < 5.minutes.ago
    token
  end

  def revoke!
    update!(revoked_at: Time.current)
  end
end
