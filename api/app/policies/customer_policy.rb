# frozen_string_literal: true

class CustomerPolicy < ApplicationPolicy
  def index? = true
  def show? = user.can_access_customer?(record.id)
  def create? = admin?
  def update? = admin?

  class Scope < Scope
    def resolve
      user.admin? ? scope.all : scope.where(id: user.accessible_customer_ids)
    end
  end
end
