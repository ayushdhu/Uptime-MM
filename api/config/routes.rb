# frozen_string_literal: true

Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    namespace :v1 do
      post "auth/login", to: "auth#login"
      delete "auth/logout", to: "auth#logout"
      get "me", to: "me#show"

      resources :customers, only: %i[index show create update]
      resources :checklist_templates, only: %i[index show] do
        post :publish, on: :member
      end

      resources :machines, only: %i[index show create update] do
        get :lookup, on: :collection
        post :retag, on: :member
        get :history, on: :member
        resources :consumable_records, only: %i[index create]
      end

      resources :inspections, only: %i[index show create] do
        member do
          post :items, action: :create_items
          post :signatures, action: :create_signature
          post :lock
          get :notes
          post :notes, action: :create_note
          get "report", action: :report, defaults: { format: "pdf" }
        end
      end

      post "photos/presign", to: "photos#presign"
      post "photos/confirm", to: "photos#confirm"

      resources :high_severity_events, only: %i[index create] do
        post :resolve, on: :member
      end

      resources :discrepancy_alerts, only: %i[index] do
        post :review, on: :member
      end
    end
  end

  # Local object store stand-in for S3 (development/test only; 404 when S3 is configured).
  put "dev/storage/*key", to: "dev/storage#put", format: false
  get "dev/storage/*key", to: "dev/storage#get", format: false
end
