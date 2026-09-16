# frozen_string_literal: true

module Api
  module V1
    class PhotosController < BaseController
      # Payloads are flat; wrapping them under :photo only produces
      # "Unpermitted parameter: :photo" noise on every confirm.
      wrap_parameters false

      # POST /api/v1/photos/presign
      #   { purpose: "photo"|"signature", inspection_item_id | inspection_id, client_generated_id, content_type }
      # -> { upload_url, s3_key }
      def presign
        purpose = params.fetch(:purpose, "photo").to_s
        client_id = params.require(:client_generated_id)
        case purpose
        when "photo"
          item = find_item(params.require(:inspection_item_id))
          unless item
            skip_authorization
            return render json: { error: "item_not_found", message: "no inspection item with that id or client_generated_id" }, status: :not_found
          end
          authorize item.inspection, :update?
          return render_locked if item.inspection.locked?
          ext = params[:content_type].to_s == "image/png" ? "png" : "jpg"
          key = ObjectKeys.photo(item.inspection_id, client_id, ext)
          content_type = ext == "png" ? "image/png" : "image/jpeg"
        when "signature"
          inspection = Inspection.find(params.require(:inspection_id))
          authorize inspection, :update?
          return render_locked if inspection.locked?
          key = ObjectKeys.signature(inspection.id, client_id)
          content_type = "image/png"
        else
          skip_authorization
          return render_error(:bad_request, "purpose must be photo or signature")
        end
        render json: { upload_url: Storage.presign_put(key, content_type: content_type), s3_key: key,
                       content_type: content_type, server_time: Time.current.utc.iso8601(3) }
      end

      # POST /api/v1/photos/confirm
      #   { s3_key, sha256, inspection_item_id, client_generated_id, captured_at, byte_size?, width?, height? }
      # Recomputes SHA-256 server side and rejects on mismatch. Idempotent.
      def confirm
        attrs = params.permit(:s3_key, :sha256, :inspection_item_id, :client_generated_id, :captured_at, :byte_size,
                              :width, :height)
        item = find_item(attrs.delete(:inspection_item_id))
        unless item
          skip_authorization
          return render json: { error: "item_not_found", message: "no inspection item with that id or client_generated_id; sync items before photos" },
                        status: :not_found
        end
        authorize item.inspection, :update?
        if (existing = Photo.find_by(client_generated_id: attrs[:client_generated_id]))
          return render_record(existing, Serializers::Photo, extra: { existing: true })
        end
        return render_locked if item.inspection.locked?

        HashVerifier.verify!(attrs[:s3_key], attrs[:sha256])
        photo = item.photos.create!(attrs.merge(byte_size: Storage.byte_size(attrs[:s3_key]), uploaded_at: Time.current))
        render_record(photo, Serializers::Photo, status: :created)
      rescue HashVerifier::Mismatch => e
        render json: { error: "hash_mismatch", message: "stored object does not match the supplied SHA-256: #{e.message}. " \
                                                       "Re-upload the object and confirm again." }, status: :unprocessable_content
      rescue Storage::NotFound
        render json: { error: "object_missing", message: "no object at #{attrs[:s3_key]}; upload it to the presigned URL before confirming" },
               status: :unprocessable_content
      end

      private

      def find_item(value)
        return nil if value.blank?
        InspectionItem.where(id: value).or(InspectionItem.where(client_generated_id: value)).includes(:inspection).first
      end
    end
  end
end
