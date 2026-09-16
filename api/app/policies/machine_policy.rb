# frozen_string_literal: true

class MachinePolicy < ApplicationPolicy
  def index? = true
  def show? = user.can_access_customer?(record.customer_id)
  def lookup? = true
  def history? = show?
  def create? = senior?                       # setup wizard
  def retag? = senior? && show?
  def update? = admin?
  def update_consumables? = technician? && show?

  class Scope < Scope
    def resolve
      user.admin? ? scope.all : scope.where(customer_id: user.accessible_customer_ids)
    end
  end
end
