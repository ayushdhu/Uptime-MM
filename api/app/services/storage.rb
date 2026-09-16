# frozen_string_literal: true

# Object storage facade. S3 (or any S3 compatible store) in production; a local
# disk store for development and tests so the whole flow, including presigned
# uploads and server side hash verification, runs without credentials.
module Storage
  class NotFound < StandardError; end

  def self.backend
    @backend ||= begin
      if ENV["S3_BUCKET"].present?
        S3Backend.new(bucket: ENV.fetch("S3_BUCKET"))
      else
        LocalBackend.new(root: Rails.root.join("tmp/storage", Rails.env))
      end
    end
  end

  def self.reset!
    @backend = nil
  end

  class << self
    delegate :presign_put, :presign_get, :write, :read, :exists?, :byte_size, :sha256, :delete, :local?, to: :backend
  end

  class S3Backend
    def initialize(bucket:)
      require "aws-sdk-s3"
      @bucket = bucket
      opts = { region: ENV.fetch("AWS_REGION", "us-east-1") }
      opts[:endpoint] = ENV["S3_ENDPOINT"] if ENV["S3_ENDPOINT"].present?
      opts[:force_path_style] = true if ENV["S3_FORCE_PATH_STYLE"].present?
      @client = Aws::S3::Client.new(opts)
      @resource = Aws::S3::Resource.new(client: @client)
    end

    def local? = false

    def presign_put(key, content_type:, expires_in: 15.minutes)
      @resource.bucket(@bucket).object(key).presigned_url(:put, expires_in: expires_in.to_i, content_type: content_type)
    end

    def presign_get(key, expires_in: 1.hour)
      @resource.bucket(@bucket).object(key).presigned_url(:get, expires_in: expires_in.to_i)
    end

    def write(key, io, content_type: "application/octet-stream")
      @client.put_object(bucket: @bucket, key: key, body: io, content_type: content_type)
    end

    def read(key)
      @client.get_object(bucket: @bucket, key: key).body.read
    rescue Aws::S3::Errors::NoSuchKey
      raise NotFound, key
    end

    def exists?(key)
      @client.head_object(bucket: @bucket, key: key)
      true
    rescue Aws::S3::Errors::NotFound
      false
    end

    def byte_size(key)
      @client.head_object(bucket: @bucket, key: key).content_length
    rescue Aws::S3::Errors::NotFound
      raise NotFound, key
    end

    # Streams the object and hashes it; never trusts a client supplied value.
    def sha256(key)
      digest = Digest::SHA256.new
      @client.get_object(bucket: @bucket, key: key) { |chunk| digest << chunk }
      digest.hexdigest
    rescue Aws::S3::Errors::NoSuchKey
      raise NotFound, key
    end

    def delete(key)
      @client.delete_object(bucket: @bucket, key: key)
    end
  end

  class LocalBackend
    attr_reader :root

    def initialize(root:)
      @root = Pathname(root)
      FileUtils.mkdir_p(@root)
    end

    def local? = true

    # Presigned PUTs point at the dev-only upload endpoint (see routes).
    def presign_put(key, content_type:, expires_in: 15.minutes)
      "#{base_url}/dev/storage/#{key}"
    end

    def presign_get(key, expires_in: 1.hour)
      "#{base_url}/dev/storage/#{key}"
    end

    def write(key, io, content_type: nil)
      path = path_for(key)
      FileUtils.mkdir_p(path.dirname)
      data = io.respond_to?(:read) ? io.read : io
      File.binwrite(path, data)
    end

    def read(key)
      raise NotFound, key unless exists?(key)
      File.binread(path_for(key))
    end

    def exists?(key)
      path_for(key).file?
    end

    def byte_size(key)
      raise NotFound, key unless exists?(key)
      path_for(key).size
    end

    def sha256(key)
      raise NotFound, key unless exists?(key)
      Digest::SHA256.file(path_for(key)).hexdigest
    end

    def delete(key)
      FileUtils.rm_f(path_for(key))
    end

    def path_for(key)
      clean = key.to_s.gsub("..", "").sub(%r{\A/+}, "")
      @root.join(clean)
    end

    private

    def base_url
      ENV.fetch("API_BASE_URL", "http://localhost:3000")
    end
  end
end
