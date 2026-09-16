# frozen_string_literal: true

module Api
  module V1
    class CustomersController < BaseController
      # GET /api/v1/customers?since=  (reference data pull)
      def index
        customers = policy_scope(Customer).order(:name)
        customers = customers.where("customers.updated_at > ?", since_param) if since_param
        render_collection(customers, Serializers::Customer)
      end

      def show
        customer = Customer.find(params[:id])
        authorize customer
        render_record(customer, Serializers::Customer)
      end

      # POST /api/v1/customers (admin)
      def create
        authorize Customer
        customer = Customer.create!(customer_params)
        render_record(customer, Serializers::Customer, status: :created)
      end

      def update
        customer = Customer.find(params[:id])
        authorize customer
        customer.update!(customer_params)
        render_record(customer, Serializers::Customer)
      end

      private

      def customer_params
        params.require(:customer).permit(:name, :billing_address, :site_address, :contact_name, :contact_phone,
                                         :contact_email, :service_cadence, :active)
      end
    end
  end
end
