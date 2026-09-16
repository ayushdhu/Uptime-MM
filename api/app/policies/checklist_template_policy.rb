# frozen_string_literal: true

class ChecklistTemplatePolicy < ApplicationPolicy
  def index? = true
  def show? = record.published? || admin?
  def publish? = admin?

  class Scope < Scope
    def resolve
      user.admin? ? scope.all : scope.published
    end
  end
end
