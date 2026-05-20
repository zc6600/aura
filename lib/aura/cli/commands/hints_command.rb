# frozen_string_literal: true

require "thor"
require "yaml"
require "json"

module Aura
  module Commands
    class HintsCommand < Thor
      desc "list [PROJECT_PATH]", "List all files parsed for hint injection and their status"
      def list(project_path = ".")
        project_path = File.expand_path(project_path)
        unless File.directory?(project_path)
          puts "\e[31m⛔️ Error: Directory not found: #{project_path}\e[0m"
          exit 1
        end

        # Find .aura configuration
        aura_dir = Aura.find_aura_dir(project_path)
        cfg_path = aura_dir ? File.join(aura_dir, "config", "config.yml") : nil
        cfg = (cfg_path && File.exist?(cfg_path)) ? (YAML.load_file(cfg_path) || {}) : {}

        auto_inject_readme = cfg.dig("hints", "auto_inject_readme") != false
        ignore_list = cfg.dig("hints", "ignore_list") || []

        # Find all files
        injectables = []

        # 1. AURA_README.md
        readme_path = File.join(project_path, "AURA_README.md")
        if File.exist?(readme_path)
          ignored = !auto_inject_readme || ignore_list.include?("AURA_README.md")
          reason = if !auto_inject_readme
                     "auto_inject_readme: false"
                   elsif ignore_list.include?("AURA_README.md")
                     "in ignore_list"
                   else
                     nil
                   end
          injectables << {
            type: "Global Rules",
            path: "AURA_README.md",
            status: ignored ? "IGNORED" : "INJECTED",
            reason: reason
          }
        end

        # 2. .hint files
        Dir.glob(File.join(project_path, "{knowledge,tools}", "**", "*.hint")).each do |file|
          rel = file.sub(/^#{Regexp.escape(project_path)}\//, "")
          ignored = ignore_list.any? { |pat| File.fnmatch?(pat, rel, File::FNM_PATHNAME | File::FNM_DOTMATCH) || rel == pat || rel.include?(pat) }
          injectables << {
            type: ".hint File",
            path: rel,
            status: ignored ? "IGNORED" : "INJECTED",
            reason: ignored ? "in ignore_list" : nil
          }
        end

        # 3. Magic @aura-hint files
        Dir.glob(File.join(project_path, "**", "*.{py,rb,sh,md,txt}")).each do |file|
          next if file.include?("/.git/") || file.include?("/.aura/") || file.include?("/state/")
          next if File.size(file) > 102400
          rel = file.sub(/^#{Regexp.escape(project_path)}\//, "")
          
          # Read first 15 lines to see if it has a magic hint
          has_hint = false
          begin
            File.open(file, "r") do |f|
              15.times do
                line = f.gets
                break unless line
                if line =~ /@aura-hint:/
                  has_hint = true
                  break
                end
              end
            end
          rescue StandardError
          end

          if has_hint
            ignored = ignore_list.any? { |pat| File.fnmatch?(pat, rel, File::FNM_PATHNAME | File::FNM_DOTMATCH) || rel == pat || rel.include?(pat) }
            injectables << {
              type: "Magic Hint (@aura-hint)",
              path: rel,
              status: ignored ? "IGNORED" : "INJECTED",
              reason: ignored ? "in ignore_list" : nil
            }
          end
        end

        if injectables.empty?
          puts "No files found for hint injection in #{project_path}."
          return
        end

        # Display results
        puts "\n=== Hint & Guidance Injection Files ==="
        puts sprintf("%-28s %-50s %-12s %s", "TYPE", "FILE PATH", "STATUS", "REASON")
        puts "-" * 110
        injectables.each do |item|
          status_color = item[:status] == "INJECTED" ? "\e[32mINJECTED\e[0m" : "\e[33mIGNORED\e[0m"
          reason_str = item[:reason] ? "(\e[31m#{item[:reason]}\e[0m)" : ""
          puts sprintf("%-28s %-50s %-20s %s", item[:type], item[:path], status_color, reason_str)
        end
        puts "-" * 110
        puts "\n💡 Use 'aura hints toggle <FILE_PATH>' to manually enable/disable injection for a file."
      end

      desc "toggle FILE_PATH [PROJECT_PATH]", "Toggle hint injection status for a specific file"
      def toggle(file_path, project_path = ".")
        project_path = File.expand_path(project_path)
        # Find .aura configuration
        aura_dir = Aura.find_aura_dir(project_path)
        unless aura_dir
          puts "\e[31m⛔️ Error: Not in an Aura workspace.\e[0m"
          exit 1
        end

        cfg_path = File.join(aura_dir, "config", "config.yml")
        cfg = File.exist?(cfg_path) ? (YAML.load_file(cfg_path) || {}) : {}
        cfg["hints"] ||= {}
        cfg["hints"]["ignore_list"] ||= []

        # If it's AURA_README.md, we toggle auto_inject_readme
        if file_path == "AURA_README.md"
          current = cfg["hints"]["auto_inject_readme"] != false
          new_state = !current
          cfg["hints"]["auto_inject_readme"] = new_state
          File.write(cfg_path, YAML.dump(cfg))
          status_msg = new_state ? "\e[32mENABLED\e[0m" : "\e[33mDISABLED\e[0m"
          puts "Toggled AURA_README.md injection. Now: #{status_msg} (via auto_inject_readme)"
          return
        end

        # Otherwise toggle in ignore_list
        list = cfg["hints"]["ignore_list"]
        if list.include?(file_path)
          list.delete(file_path)
          File.write(cfg_path, YAML.dump(cfg))
          puts "Removed '#{file_path}' from ignore_list. Injection is now \e[32mENABLED\e[0m."
        else
          list << file_path
          File.write(cfg_path, YAML.dump(cfg))
          puts "Added '#{file_path}' to ignore_list. Injection is now \e[33mIGNORED\e[0m."
        end
      end
    end
  end
end
