# frozen_string_literal: true

class InspectionReport < ApplicationRecord
  belongs_to :inspection
  validates :s3_key, :sha256, :byte_size, :page_count, :generated_at, presence: true
  validates :sha256, format: { with: Photo::SHA256_FORMAT }
end
