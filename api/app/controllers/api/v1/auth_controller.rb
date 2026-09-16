# frozen_string_literal: true

module Api
  module V1
    class AuthController < BaseController
      skip_before_action :authenticate!, only: :login
      skip_after_action :verify_authorized

      # POST /api/v1/auth/login { email, password, device_id }
      def login
        user = User.active.find_by(email: params.require(:email).to_s.strip.downcase)
        unless user&.authenticate(params.require(:password))
          return render_error(:unauthorized, "invalid email or password")
        end
        _token, raw = ApiToken.issue!(user: user, device_id: params.require(:device_id))
        render json: { token: raw, user: Serializers::User.call(user), server_time: Time.current.utc.iso8601(3) }, status: :created
      end

      # DELETE /api/v1/auth/logout
      def logout
        current_token.revoke!
        head :no_content
      end
    end
  end
end
