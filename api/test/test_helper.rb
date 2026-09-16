# frozen_string_literal: true

ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

Dir[Rails.root.join("test/support/**/*.rb")].each { |f| require f }

module ActiveSupport
  class TestCase
    include Uptime::TestFactories

    parallelize(workers: 1)

    setup do
      Storage.reset!
      FileUtils.rm_rf(Rails.root.join("tmp/storage/test"))
      @templates ||= ChecklistSeeder.run(logger: Logger.new(nil))
    end
  end
end
