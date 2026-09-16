# frozen_string_literal: true

module Api
  module V1
    class MachinesController < BaseController
      # GET /api/v1/machines?since=   (reference data pull, scoped to assigned customers)
      def index
        machines = policy_scope(Machine).includes(:checklist_template).updated_since(since_param).order(:serial_number)
        render_collection(machines, Serializers::Machine)
      end

      # GET /api/v1/machines/lookup?nfc=... | ?serial=... | ?q=...
      # All three resolve to the same machines.id.
      def lookup
        skip_authorization # visibility is enforced by the policy scope below
        scope = policy_scope(Machine).includes(:customer, :checklist_template)
        if params[:nfc].present?
          machine = scope.find_by(nfc_tag_id: params[:nfc].to_s.strip)
          return render_error(:not_found, "unregistered tag") unless machine
          render_record(machine, Serializers::Machine)
        elsif params[:serial].present?
          machine = scope.find_by("upper(serial_number) = ?", params[:serial].to_s.strip.upcase)
          return render_error(:not_found, "no machine with that serial number") unless machine
          render_record(machine, Serializers::Machine)
        elsif params[:q].present?
          q = params[:q].to_s.strip
          matches = scope.joins(:customer)
                         .where("upper(machines.serial_number) LIKE :s OR lower(customers.name) LIKE :n",
                                s: "%#{Machine.sanitize_sql_like(q.upcase)}%", n: "%#{Machine.sanitize_sql_like(q.downcase)}%")
                         .order(:serial_number).limit(50)
          render_collection(matches, Serializers::Machine)
        else
          render_error(:bad_request, "provide nfc, serial or q")
        end
      end

      def show
        machine = Machine.find(params[:id])
        authorize machine
        render_record(machine, Serializers::Machine)
      end

      # POST /api/v1/machines (setup wizard payload). Returns the machine with
      # its locked template. If the serial already exists, returns that
      # machine (200) instead of creating a duplicate.
      def create
        authorize Machine
        attrs = machine_params
        existing = Machine.find_by("upper(serial_number) = ?", attrs[:serial_number].to_s.strip.upcase)
        if existing
          authorize existing, :show?
          return render_record(existing, Serializers::Machine, extra: { existing: true })
        end
        template = ChecklistTemplate.select_for(machine_class: attrs[:machine_class], drive_type: attrs[:drive_type],
                                                has_def: ActiveModel::Type::Boolean.new.cast(attrs[:has_def]))
        return render_error(:unprocessable_content, "no published checklist template for that machine variant") unless template
        raise Pundit::NotAuthorizedError unless current_user.can_access_customer?(attrs[:customer_id])

        machine = Machine.transaction do
          m = Machine.create!(attrs.except(:nfc_tag_id).merge(checklist_template: template))
          m.retag!(attrs[:nfc_tag_id], by: current_user) if attrs[:nfc_tag_id].present?
          m
        end
        render_record(machine, Serializers::Machine, status: :created)
      end

      # POST /api/v1/machines/:id/retag { nfc_tag_id }
      def retag
        machine = Machine.find(params[:id])
        authorize machine
        machine.retag!(params.require(:nfc_tag_id), by: current_user)
        render_record(machine, Serializers::Machine)
      end

      # PATCH /api/v1/machines/:id (admin: customer reassignment on sale, hour meter, active)
      def update
        machine = Machine.find(params[:id])
        authorize machine
        machine.update!(params.require(:machine).permit(:customer_id, :current_hour_meter, :estimated_hours_per_week, :active,
                                                        :make, :model, :year))
        render_record(machine, Serializers::Machine)
      end

      # GET /api/v1/machines/:id/history
      def history
        machine = Machine.find(params[:id])
        authorize machine
        render json: { data: Serializers::MachineHistory.call(machine), server_time: Time.current.utc.iso8601(3) }
      end

      private

      def machine_params
        params.require(:machine).permit(:customer_id, :serial_number, :nfc_tag_id, :make, :model, :year, :machine_class,
                                        :drive_type, :has_def, :current_hour_meter, :estimated_hours_per_week)
      end
    end
  end
end
