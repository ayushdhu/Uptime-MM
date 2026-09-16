# frozen_string_literal: true

# Mirrors the Postgres immutability triggers in the ORM so writes fail fast
# before they reach the database (spec 4.5). Include in every model that hangs
# off an inspection and expose `inspection` (or override `guarded_inspection`).
module LockedInspectionGuard
  extend ActiveSupport::Concern

  class LockedError < ActiveRecord::ReadOnlyRecord; end

  included do
    before_destroy :raise_if_locked!, prepend: true
  end

  def guarded_inspection
    inspection
  end

  def inspection_locked?
    (i = guarded_inspection) && i.locked?
  end

  # New rows are refused too: nothing may be appended to a locked inspection
  # (notes are the exception and do not include this concern).
  def readonly?
    super || inspection_locked?
  end

  private

  def raise_if_locked!
    raise LockedError, "#{self.class.name} belongs to a locked inspection" if inspection_locked?
  end
end
