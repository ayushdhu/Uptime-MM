# frozen_string_literal: true

class User < ApplicationRecord
  has_secure_password

  enum :role, { technician: "technician", senior_technician: "senior_technician", admin: "admin", owner: "owner" }

  belongs_to :customer, optional: true # owner role only (LATER)
  has_many :api_tokens, dependent: :destroy
  has_many :customer_assignments, dependent: :destroy
  has_many :assigned_customers, through: :customer_assignments, source: :customer
  has_many :inspections, foreign_key: :technician_id, inverse_of: :technician, dependent: :restrict_with_exception

  validates :name, presence: true
  validates :email, presence: true, format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :email, uniqueness: { case_sensitive: false }
  validates :customer_id, presence: true, if: :owner?
  validates :customer_id, absence: true, unless: :owner?

  before_validation { self.email = email.to_s.strip.downcase }

  scope :active, -> { where(active: true) }

  def technician_level?
    technician? || senior_technician?
  end

  # Admins see everything; technicians see the customers they are assigned to.
  def accessible_customer_ids
    return Customer.pluck(:id) if admin?
    return [customer_id] if owner?
    customer_assignments.pluck(:customer_id)
  end

  def can_access_customer?(customer_id)
    return true if admin?
    return self.customer_id == customer_id if owner?
    customer_assignments.exists?(customer_id: customer_id)
  end
end
