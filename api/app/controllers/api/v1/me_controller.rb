# frozen_string_literal: true

module Api
  module V1
    class MeController < BaseController
      skip_after_action :verify_authorized

      def show
        render json: { data: Serializers::User.call(current_user), server_time: Time.current.utc.iso8601(3) }
      end
    end
  end
end
