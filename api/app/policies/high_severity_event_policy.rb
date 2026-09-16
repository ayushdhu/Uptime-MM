# frozen_string_literal: true

class HighSeverityEventPolicy < ApplicationPolicy
  def index? = true
  def show? = user.can_access_customer?(record.machine.customer_id)
  def create? = technician?
  def resolve? = senior? && show?

  class Scope < Scope
    def resolve
      return scope.all if user.admin?
      scope.joins(:machine).where(machines: { customer_id: user.accessible_customer_ids })
    end
  end
end
