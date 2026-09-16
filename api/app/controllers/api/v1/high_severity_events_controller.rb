# frozen_string_literal: true

module Api
  module V1
    class HighSeverityEventsController < BaseController
      # GET /api/v1/high_severity_events?machine_id=&open=true
      def index
        scope = policy_scope(HighSeverityEvent).includes(:inspection_item, :owner_signature).order(:opened_at)
        scope = scope.where(machine_id: params[:machine_id]) if params[:machine_id].present?
        scope = scope.open if ActiveModel::Type::Boolean.new.cast(params[:open])
        render_collection(scope, Serializers::HighSeverityEvent)
      end

      # POST /api/v1/high_severity_events
      def create
        attrs = params.require(:high_severity_event)
                      .permit(:client_generated_id, :inspection_item_id, :opened_at, :machine_out_of_service,
                              :recheck_interval_days, :repair_plan, :owner_signature_id, conversation_checklist: {})
        if (existing = HighSeverityEvent.find_by(client_generated_id: attrs[:client_generated_id]))
          authorize existing, :show?
          return render_record(existing, Serializers::HighSeverityEvent, extra: { existing: true })
        end
        item = InspectionItem.where(id: attrs[:inspection_item_id])
                             .or(InspectionItem.where(client_generated_id: attrs[:inspection_item_id])).first!
        authorize item.inspection, :update?
        return render_locked if item.inspection.locked?
        signature = Signature.where(id: attrs[:owner_signature_id])
                             .or(Signature.where(client_generated_id: attrs[:owner_signature_id])).first!
        event = HighSeverityEvent.create!(attrs.merge(inspection_item: item, owner_signature: signature,
                                                      machine_id: item.inspection.machine_id))
        render_record(event, Serializers::HighSeverityEvent, status: :created)
      end

      # POST /api/v1/high_severity_events/:id/resolve { inspection_id, resolution_note }
      def resolve
        event = HighSeverityEvent.find(params[:id])
        authorize event
        inspection = Inspection.find(params.require(:inspection_id))
        authorize inspection, :update?
        return render_error(:unprocessable_content, "already resolved") unless event.open?
        return render_error(:unprocessable_content, "resolving inspection must be on the same machine") if inspection.machine_id != event.machine_id
        event.resolve!(by: current_user, in_inspection: inspection, note: params.require(:resolution_note))
        render_record(event, Serializers::HighSeverityEvent)
      end
    end
  end
end
