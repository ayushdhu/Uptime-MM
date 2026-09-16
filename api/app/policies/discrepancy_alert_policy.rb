# frozen_string_literal: true

class DiscrepancyAlertPolicy < ApplicationPolicy
  def index? = admin?
  def review? = admin?

  class Scope < Scope
    def resolve
      user.admin? ? scope.all : scope.none
    end
  end
end
