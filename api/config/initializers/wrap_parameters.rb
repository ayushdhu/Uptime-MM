# frozen_string_literal: true

# Default JSON params wrapping stays on for resource controllers; flat payload
# controllers (photos presign/confirm) opt out with `wrap_parameters false`.
ActiveSupport.on_load(:action_controller) do
  wrap_parameters format: [:json]
end
