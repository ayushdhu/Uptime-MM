# frozen_string_literal: true

module Api
  module V1
    class DiscrepancyAlertsController < BaseController
      def index
        authorize DiscrepancyAlert # admin only: technicians get 403, not an empty list
        alerts = policy_scope(DiscrepancyAlert).includes(:machine, inspection_a: :technician, inspection_b: :technician)
                                               .order(created_at: :desc)
        alerts = alerts.unreviewed unless ActiveModel::Type::Boolean.new.cast(params[:include_reviewed])
        render_collection(alerts, Serializers::DiscrepancyAlert)
      end

      def review
        alert = DiscrepancyAlert.find(params[:id])
        authorize alert
        alert.update!(reviewed_at: Time.current, reviewed_by_user: current_user)
        render_record(alert, Serializers::DiscrepancyAlert)
      end
    end
  end
end
