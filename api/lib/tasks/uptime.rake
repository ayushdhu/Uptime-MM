# frozen_string_literal: true

namespace :uptime do
  namespace :templates do
    desc "Point every active machine at the highest published checklist version for its variant (existing inspections keep theirs)"
    task upgrade_machines: :environment do
      Machine.active.find_each do |m|
        best = ChecklistTemplate.select_for(machine_class: m.machine_class, drive_type: m.drive_type, has_def: m.has_def)
        next if best.nil? || best.id == m.checklist_template_id
        m.update!(checklist_template: best)
        puts "#{m.serial_number}: #{m.checklist_template.version} -> #{best.version}"
      end
    end
  end
end
