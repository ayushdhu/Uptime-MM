# frozen_string_literal: true

module Dev
  # Local object store endpoints, mounted only when Storage runs on disk
  # (development/test without S3_BUCKET). Mirrors a presigned S3 PUT/GET.
  class StorageController < ActionController::API
    before_action :ensure_local_backend

    def put
      Storage.write(params[:key], request.body.read, content_type: request.content_type)
      head :ok
    end

    def get
      send_data Storage.read(params[:key]), type: Marcel::MimeType.for(name: params[:key]), disposition: "inline"
    rescue Storage::NotFound
      head :not_found
    end

    private

    def ensure_local_backend
      head :not_found unless Storage.local?
    end
  end
end
