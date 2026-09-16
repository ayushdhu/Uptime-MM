# frozen_string_literal: true

module Api
  module V1
    class ChecklistTemplatesController < BaseController
      # GET /api/v1/checklist_templates?since=   (published only)
      def index
        templates = policy_scope(ChecklistTemplate).updated_since(since_param).order(:machine_class, :version)
        render_collection(templates, Serializers::ChecklistTemplate)
      end

      def show
        template = ChecklistTemplate.find(params[:id])
        authorize template
        render_record(template, Serializers::ChecklistTemplate)
      end

      # POST /api/v1/checklist_templates/:id/publish (admin)
      def publish
        template = ChecklistTemplate.find(params[:id])
        authorize template
        template.publish!
        render_record(template, Serializers::ChecklistTemplate)
      end
    end
  end
end
