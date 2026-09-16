# frozen_string_literal: true

module Api
  module V1
    class BaseController < ApplicationController
      private

      def render_collection(records, serializer, extra = {})
        render json: { data: records.map { |r| serializer.call(r) }, server_time: Time.current.utc.iso8601(3) }.merge(extra)
      end

      def render_record(record, serializer, status: :ok, extra: {})
        render json: { data: serializer.call(record), server_time: Time.current.utc.iso8601(3) }.merge(extra), status: status
      end
    end
  end
end
