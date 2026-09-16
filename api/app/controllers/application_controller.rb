# frozen_string_literal: true

class ApplicationController < ActionController::API
  include Pundit::Authorization

  CLOCK_SKEW_WARN = 10.minutes

  before_action :authenticate!
  before_action :check_device_clock
  after_action :verify_authorized, unless: -> { action_name == "index" }
  after_action :verify_policy_scoped, if: -> { action_name == "index" }

  rescue_from ActiveRecord::RecordNotFound do |e|
    render_error(:not_found, e.message)
  end
  rescue_from Pundit::NotAuthorizedError do
    render_error(:forbidden, "not authorized")
  end
  rescue_from ActiveRecord::RecordInvalid do |e|
    render json: { error: "validation_failed", details: e.record.errors.full_messages }, status: :unprocessable_content
  end
  rescue_from ActionController::ParameterMissing do |e|
    render_error(:bad_request, e.message)
  end
  # Locked inspection: the ORM guard, or the Postgres trigger if something slipped past it.
  rescue_from ActiveRecord::ReadOnlyRecord do |e|
    render_error(:conflict, "inspection is locked: #{e.message}")
  end
  rescue_from ActiveRecord::StatementInvalid do |e|
    raise e unless e.cause.is_a?(PG::IntegrityConstraintViolation)
    render_error(:conflict, e.cause.message.lines.first.to_s.strip)
  end

  attr_reader :current_user, :current_token

  private

  def authenticate!
    raw = request.authorization.to_s[/\ABearer (.+)\z/, 1]
    @current_token = ApiToken.authenticate(raw)
    @current_user = @current_token&.user
    render_error(:unauthorized, "invalid or missing token") unless @current_user
  end

  def pundit_user
    current_user
  end

  def device_id
    request.headers["X-Device-Id"].presence || current_token&.device_id
  end

  # Spec 7.10: log a warning when device and server clocks disagree by > 10 minutes.
  def check_device_clock
    header = request.headers["X-Device-Time"]
    return if header.blank?
    device_time = Time.zone.parse(header)
    return unless device_time
    skew = (device_time - Time.current).abs
    return if skew <= CLOCK_SKEW_WARN
    Rails.logger.warn("clock skew #{skew.round}s for device #{device_id} user #{current_user&.id}")
    response.headers["X-Clock-Skew-Seconds"] = skew.round.to_s
  rescue ArgumentError
    nil
  end

  def render_error(status, message)
    render json: { error: status.to_s, message: message, server_time: Time.current.utc.iso8601(3) }, status: status
  end

  def render_locked
    render_error(:conflict, "inspection is locked")
  end

  def since_param
    return nil if params[:since].blank?
    Time.zone.parse(params[:since].to_s)
  end
end
