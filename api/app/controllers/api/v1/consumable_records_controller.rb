# frozen_string_literal: true

module Api
  module V1
    class ConsumableRecordsController < BaseController
      # POST /api/v1/machines/:machine_id/consumable_records (minimal MVP UI)
      def create
        machine = Machine.find(params[:machine_id])
        authorize machine, :update_consumables?
        attrs = params.require(:consumable_record).permit(:inspection_id, :consumable_type, :changed_at,
                                                          :hour_meter_at_change, :source, :interval_hours, :note)
        record = machine.consumable_records.create!(attrs)
        render_record(record, Serializers::ConsumableRecord, status: :created)
      end

      def index
        machine = Machine.find(params[:machine_id])
        authorize machine, :show?
        skip_policy_scope
        render_collection(machine.consumable_records.order(changed_at: :desc), Serializers::ConsumableRecord)
      end
    end
  end
end
