# frozen_string_literal: true

class NfcTagHistory < ApplicationRecord
  self.table_name = "nfc_tag_history"

  belongs_to :machine
  belongs_to :assigned_by_user, class_name: "User", optional: true

  validates :nfc_tag_id, :assigned_at, presence: true
end
