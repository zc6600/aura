# frozen_string_literal: true

require "thor"
require "yaml"
require "fileutils"

module Aura
  module Commands
    class SkillsCommand < Thor
      desc "list [PROJECT_PATH]", "List all skills and their status in the active workspace"
      def list(project_path = nil)
        # Resolve project path
        begin
          resolved_path = Aura.resolve_project_path!(project_path)
        rescue SystemExit
          exit 1
        end

        skills_dir = File.join(resolved_path, "skills")
        template_skills_dir = File.expand_path("../../generators/aura/app/templates/skills", __dir__)

        # Find folders containing SKILL.md under resolved path skills/ or gem templates/skills/
        skill_paths = {}
        [template_skills_dir, skills_dir].each do |base_dir|
          next unless File.directory?(base_dir)
          Dir.glob(File.join(base_dir, "*/SKILL.md")).each do |skill_file|
            skill_name = File.basename(File.dirname(skill_file))
            skill_paths[skill_name] = skill_file
          end
        end

        if skill_paths.empty?
          puts "No skills found in workspace."
          return
        end

        puts "\e[34mℹ️ Available Agent Skills:\e[0m"
        puts "-" * 60

        skill_paths.sort.each do |name, path|
          meta = parse_skill_meta(path)
          puts "\e[32m* #{name}\e[0m"
          puts "  Description: #{meta[:description]}" if meta[:description]
          puts "  Location:    #{path.sub(Dir.home, '~')}"
          puts "-" * 60
        end
      end

      map "run" => :skill_run

      desc "run NAME [PROJECT_PATH]", "Start an interactive session with the specified skill activated"
      def skill_run(name, project_path = nil)
        resolved_path = Aura.resolve_project_path!(project_path)
        
        # Verify the skill exists
        skills_dir = File.join(resolved_path, "skills")
        template_skills_dir = File.expand_path("../../generators/aura/app/templates/skills", __dir__)
        skill_exists = [skills_dir, template_skills_dir].any? do |base_dir|
          File.exist?(File.join(base_dir, name, "SKILL.md"))
        end

        unless skill_exists
          puts "\e[31m⛔️ Error: Skill '#{name}' not found.\e[0m"
          puts "Run 'aura skill list' to see available skills."
          exit 1
        end

        puts "\e[32m🚀 Starting Aura with skill '#{name}' activated...\e[0m"
        ENV["AURA_ACTIVE_SKILL"] = name.to_s
        
        # Delegate to ShellCommand
        require "aura/cli/commands/shell_command"
        Aura::Commands::ShellCommand.new.start(resolved_path)
      end

      private

      def parse_skill_meta(path)
        content = File.read(path, encoding: "utf-8")
        meta = { name: File.basename(File.dirname(path)), description: nil }
        
        # Extract YAML front-matter if present
        if content.start_with?("---")
          parts = content.split("---", 3)
          if parts[1]
            begin
              yaml = YAML.safe_load(parts[1])
              if yaml.is_a?(Hash)
                meta[:name] = yaml["name"] || meta[:name]
                meta[:description] = yaml["description"] || meta[:description]
              end
            rescue StandardError
            end
          end
        end

        # Fallback to parsing markdown headers if description is still blank
        if meta[:description].nil? || meta[:description].empty?
          first_h1 = content.lines.find { |line| line.start_with?("# ") }
          meta[:description] = first_h1 ? first_h1.sub("# ", "").strip : "No description provided."
        end

        meta
      end
    end
  end
end
