# frozen_string_literal: true

# Checklist templates: always seeded, in every environment.
ChecklistSeeder.run(logger: Logger.new($stdout))

# Pilot fixtures: only outside production, and only when the yard is empty.
if !Rails.env.production? && User.none?
  admin = User.create!(name: "Uptime Admin", email: "admin@uptime.local", password: "changeme-admin", role: "admin")
  senior = User.create!(name: "Sam Senior", email: "senior@uptime.local", password: "changeme-senior", role: "senior_technician")
  tech = User.create!(name: "Terry Tech", email: "tech@uptime.local", password: "changeme-tech", role: "technician")

  yard = Customer.create!(name: "Pilot Yard", site_address: "1 Yard Rd", contact_name: "Owner Olly",
                          contact_phone: "555-0100", service_cadence: "weekly")
  [senior, tech].each { |u| CustomerAssignment.create!(user: u, customer: yard) }

  template = ChecklistTemplate.select_for(machine_class: "skid_steer", drive_type: "wheeled", has_def: true)
  Machine.create!(customer: yard, serial_number: "PILOT-SS-0001", nfc_tag_id: "04A1B2C3D4E5F6", make: "Bobcat", model: "S650",
                  year: 2019, machine_class: "skid_steer", drive_type: "wheeled", has_def: true,
                  checklist_template: template, current_hour_meter: 1240, estimated_hours_per_week: 20)
  puts "seeded pilot users (admin@uptime.local / senior@uptime.local / tech@uptime.local), customer #{yard.name}, one skid steer"
end
