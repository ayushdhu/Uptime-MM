# frozen_string_literal: true

# Append only. The only way to add information to a locked inspection.
class InspectionNote < ApplicationRecord
  enum :author_role, { technician: "technician", admin: "admin", owner: "owner" }

  belongs_to :inspection
  belongs_to :inspection_item, optional: true
  belongs_to :author_user, class_name: "User"

  validates :body, :author_role, :client_generated_id, presence: true
  validates :client_generated_id, uniqueness: true
  validate :item_belongs_to_inspection

  before_validation :snapshot_author_role, on: :create

  def readonly?
    persisted?
  end

  def destroy
    raise ActiveRecord::ReadOnlyRecord, "inspection notes are append only"
  end
  alias destroy! destroy

  private

  def snapshot_author_role
    return if author_role.present? || author_user.nil?
    self.author_role = author_user.admin? ? "admin" : (author_user.owner? ? "owner" : "technician")
  end

  def item_belongs_to_inspection
    return unless inspection_item && inspection
    errors.add(:inspection_item, "belongs to a different inspection") if inspection_item.inspection_id != inspection_id
  end
end
