# frozen_string_literal: true

# The server never trusts a client supplied hash: it recomputes SHA-256 over the
# stored object and rejects the confirmation on mismatch (spec 4.2, photos).
module HashVerifier
  class Mismatch < StandardError; end

  module_function

  def verify!(s3_key, claimed_sha256)
    claimed = claimed_sha256.to_s.downcase
    raise Mismatch, "sha256 must be 64 hex characters" unless claimed.match?(Photo::SHA256_FORMAT)
    actual = Storage.sha256(s3_key)
    raise Mismatch, "stored object hash #{actual} does not match claimed #{claimed}" unless actual == claimed
    actual
  end
end
