# frozen_string_literal: true

# Deterministic object keys so a retried upload lands on the same object.
module ObjectKeys
  module_function

  def photo(inspection_id, client_generated_id, ext = "jpg")
    "inspections/#{inspection_id}/photos/#{client_generated_id}.#{ext}"
  end

  def signature(inspection_id, client_generated_id)
    "inspections/#{inspection_id}/signatures/#{client_generated_id}.png"
  end

  def report(inspection_id)
    "inspections/#{inspection_id}/report.pdf"
  end
end
