# frozen_string_literal: true

class InspectionPolicy < ApplicationPolicy
  def index? = true
  def show? = user.can_access_customer?(record.customer_id)
  def create? = technician?
  # "update" means appending children (items, photos, signatures). Lock state is
  # not a policy question: controllers answer 409 for writes to a locked inspection.
  def update? = technician? && show?
  def create_items? = update?
  def create_signature? = update?
  def lock? = update?
  def notes? = show?
  def create_note? = show? # append only: allowed on locked inspections, by anyone who can see it
  def report? = show?

  class Scope < Scope
    def resolve
      user.admin? ? scope.all : scope.where(customer_id: user.accessible_customer_ids)
    end
  end
end
