# frozen_string_literal: true

require "thor"
require "yaml"
require "fileutils"

module Aura
  module Commands
    class SkillsCommand < Thor
      desc "list [PROJECT_PATH]", "List all skills and their status in the active workspace"
      method_option :json, type: :boolean, aliases: "-j", default: false, desc: "Output in JSON format"
      def list(project_path = nil)
        # Resolve project path
        begin
          resolved_path = Aura::PathResolver.resolve_project_path!(project_path)
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
          puts "No skills found in workspace." unless options[:json]
          puts "[]" if options[:json]
          return
        end

        if options[:json]
          # JSON output for scripting
          output = skill_paths.sort.map do |name, path|
            meta = parse_skill_meta(path)
            {
              name: name,
              description: meta[:description],
              location: path.sub(Dir.home, "~")
            }
          end
          puts JSON.pretty_generate(output)
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
        resolved_path = Aura::PathResolver.resolve_project_path!(project_path)

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

      desc "install URL_OR_PATH [NAME]", "Install a skill from a Git URL or local directory"
      def install(url_or_path, name = nil)
        begin
          resolved_path = Aura::PathResolver.resolve_project_path!(nil)
        rescue SystemExit
          exit 1
        end

        require "securerandom"
        require "fileutils"
        require "open3"
        require "tmpdir"

        is_git = url_or_path.start_with?("http://", "https://", "git@")

        # Use Dir.mktmpdir for automatic cleanup
        Dir.mktmpdir("skill_install_") do |tmp_dir|
          if is_git
            puts "Cloning repository: #{url_or_path}..."
            _, err, status = Open3.capture3("git", "clone", "--depth", "1", url_or_path, tmp_dir)
            unless status.success?
              puts "\e[31m⛔️ Error: Failed to clone repository: #{err}\e[0m"
              exit 1
            end
            src_dir = tmp_dir
          else
            src_dir = File.expand_path(url_or_path)
            unless File.directory?(src_dir)
              puts "\e[31m⛔️ Error: Local path '#{url_or_path}' is not a directory.\e[0m"
              exit 1
            end
          end

          # Find SKILL.md
          skill_md = File.join(src_dir, "SKILL.md")
          unless File.exist?(skill_md)
            # Try to find a subfolder containing SKILL.md
            sub_skills = Dir.glob(File.join(src_dir, "**/SKILL.md"))
            if sub_skills.any?
              skill_md = sub_skills.first
              src_dir = File.dirname(skill_md)
            else
              puts "\e[31m⛔️ Error: No SKILL.md file found in the source directory.\e[0m"
              exit 1
            end
          end

          # Determine skill name
          skill_name = name
          if skill_name.nil? || skill_name.to_s.strip.empty?
            meta = parse_skill_meta(skill_md)
            skill_name = meta[:name].to_s.downcase.gsub(/[^a-z0-9_-]/, "") if meta[:name] && meta[:name] != File.basename(File.dirname(skill_md))
            skill_name = File.basename(src_dir).downcase.gsub(/[^a-z0-9_-]/, "") if skill_name.nil? || skill_name.empty?
          else
            # Sanitize and validate custom skill name to prevent directory traversal
            skill_name = skill_name.to_s.strip
            if skill_name.include?("..") || skill_name.include?("/") || skill_name.include?("\\") || !skill_name.match?(/\A[a-zA-Z0-9][a-zA-Z0-9_-]*\z/)
              puts "\e[31m⛔️ Error: Invalid skill name '#{skill_name}'. Only alphanumeric characters, underscores, and hyphens are allowed.\e[0m"
              exit 1
            end
          end

          dest_dir = File.join(resolved_path, "skills", skill_name)
          if File.exist?(dest_dir)
            puts "⛔️ Error: Skill '#{skill_name}' already exists at: #{dest_dir}"
            exit 1
          end

          FileUtils.mkdir_p(File.dirname(dest_dir))
          FileUtils.cp_r(src_dir, dest_dir)
          FileUtils.rm_rf(File.join(dest_dir, ".git"))

          puts "\e[32m✓ Skill '#{skill_name}' successfully installed to: #{dest_dir}\e[0m"
        rescue StandardError => e
          puts "\e[31m⛔️ Error during skill installation: #{e.message}\e[0m"
          exit 1

          # Dir.mktmpdir automatically cleans up tmp_dir here
        end
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
