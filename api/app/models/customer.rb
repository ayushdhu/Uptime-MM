# frozen_string_literal: true

class Customer < ApplicationRecord
  enum :service_cadence, { weekly: "weekly", biweekly: "biweekly", monthly: "monthly" }
  enum :payment_terms, { due_on_receipt: "due_on_receipt", net_30: "net_30", net_60: "net_60" } # LATER

  has_many :machines, dependent: :restrict_with_exception
  has_many :inspections, dependent: :restrict_with_exception
  has_many :customer_assignments, dependent: :destroy
  has_many :assigned_users, through: :customer_assignments, source: :user

  validates :name, presence: true

  scope :active, -> { where(active: true) }
  scope :search, ->(q) { where("lower(customers.name) LIKE ?", "%#{sanitize_sql_like(q.to_s.downcase)}%") }
end
