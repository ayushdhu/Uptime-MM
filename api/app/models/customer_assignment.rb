# frozen_string_literal: true

class CustomerAssignment < ApplicationRecord
  belongs_to :user
  belongs_to :customer
  validates :customer_id, uniqueness: { scope: :user_id }
end
