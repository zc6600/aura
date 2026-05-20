# frozen_string_literal: true

require "time"
require "json"
begin
  require "sqlite3"
rescue LoadError
end
require "yaml"

module Aura
  module Context
    class EnvironmentProvider
      def initialize(path, options = {})
        @path = path
        @env_path = options[:env_path] || Aura.environment_path(path)
        @knowledge_path = File.join(@path, "knowledge")
        @skills_path = File.join(@env_path, "skills")
      end

      def provide
        section = ["# SYSTEM & ENVIRONMENT"]

        global_rules = build_global_rules
        section << "## Global Rules\n#{global_rules}" if global_rules

        workspace_overview = build_workspace_overview
        section << "## Workspace Overview\n#{workspace_overview}" if workspace_overview

        magic_hints = scan_all_magic_hints
        section << "## Active Tags & Guidance\n#{magic_hints}" unless magic_hints.empty?

        knowledge_index = build_knowledge_index
        section << "## Knowledge Assets\n#{knowledge_index}" if knowledge_index

        skills_knowledge = build_skills_knowledge
        section << "## Skills Knowledge\n#{skills_knowledge}" if skills_knowledge

        user_task = build_user_task_view
        section << "## 用户任务视图\n#{user_task}" if user_task

        active_tools = active_tool_context
        section << "## Active Development Context\n#{active_tools}" if active_tools

        section.join("\n\n")
      end

      private
        def build_global_rules
          cfg = load_config
          rules = []

          # 1. Load project-specific AURA_README.md
          if cfg.dig("hints", "auto_inject_readme") != false && !ignored?("AURA_README.md")
            file = File.join(@path, "AURA_README.md")
            if File.exist?(file)
              content = File.read(file).strip
              unless content.empty?
                max_file_chars = fetch_max_file_chars
                if content.length > max_file_chars
                  content = content[0, max_file_chars] + " ... [truncated: exceeds #{max_file_chars} character limit]"
                end
                rules << "### Project Instructions (AURA_README.md):\n#{content}"
              end
            end
          end

          # 2. Load global operational guidelines from ~/.aura/global_hint.md
          global_hint_file = File.join(Dir.home, ".aura", "global_hint.md")
          if File.exist?(global_hint_file)
            content = File.read(global_hint_file).strip
            unless content.empty?
              max_file_chars = fetch_max_file_chars
              if content.length > max_file_chars
                content = content[0, max_file_chars] + " ... [truncated: exceeds #{max_file_chars} character limit]"
              end
              rules << "### Global User Preferences & Operational Rules:\n#{content}"
            end
          end

          rules.empty? ? nil : rules.join("\n\n")
        rescue StandardError
          nil
        end

        def active_tool_context
          tp = File.join(@env_path, "tools")
          return nil unless Dir.exist?(tp)
          
          active_tools = []
          Dir.glob(File.join(tp, "*")).each do |tool_dir|
            next unless File.directory?(tool_dir)
            if File.basename(tool_dir) == "anchor_submit" && !anchors_has_files?
              next
            end
            
            # Check for recent modification (last 15 mins)
            # We scan top-level files in the tool dir to check for activity
            recent = false
            ([tool_dir] + Dir.glob(File.join(tool_dir, "*"))).each do |f|
              if Time.now - File.mtime(f) < 900
                recent = true
                break
              end
            end
            
            active_tools << tool_dir if recent
          end
          
          return nil if active_tools.empty?
          
          out = []
          active_tools.each do |dir|
            name = File.basename(dir)
            
            # Use absolute path for reading content
            abs_manifest = File.join(dir, "manifest.json")
            
            # Use relative paths for display
            rel_dir = dir.sub(/^#{Regexp.escape(@env_path)}\//, "")
            manifest = File.join(rel_dir, "manifest.json")
            logic = File.join(rel_dir, "logic.py")
            test = File.join(rel_dir, "test.py")
            
            desc = "n/a"
            if File.exist?(abs_manifest)
              begin
                desc = JSON.parse(File.read(abs_manifest))["description"] || "n/a"
              rescue
              end
            end
            
            out << "### Tool: #{name}"
            out << "Description: #{desc}"
            out << "Paths:"
            out << "- Manifest: #{manifest}"
            out << "- Logic: #{logic}"
            out << "- Test: #{test}"
          end
          
          out.join("\n")
        end

        def build_workspace_overview
          items = Dir.glob(File.join(@path, "*")).map do |f|
            next if File.basename(f).start_with?(".")
            rel = f.sub(/^#{Regexp.escape(@path)}\//, "")
            type = File.directory?(f) ? "[DIR ]" : "[FILE]"
            "- #{type} #{rel}"
          end.compact
          items.any? ? items.join("\n") : nil
        end

        def build_tool_index
          tp = File.join(@env_path, "tools")
          return nil unless Dir.exist?(tp)
          Dir.glob(File.join(tp, "*")).map do |f|
            next unless File.directory?(f)
            rel = f.sub(/^#{Regexp.escape(tp)}\//, "")
            if rel == "anchor_submit" && !anchors_has_files?
              next
            end
            
            manifest_path = File.join(f, "manifest.json")
            status = if File.exist?(manifest_path)
                       begin
                         JSON.parse(File.read(manifest_path))["name"]
                       rescue StandardError
                         "invalid-manifest"
                       end
                     else
                       "incomplete"
                     end
            
            "- [Dir: #{rel}] -> Tool: #{status}"
          end.compact.join("\n")
        end

        def anchors_has_files?
          dir = File.join(@path, "anchors")
          return false unless Dir.exist?(dir)
          config_exts = [".yaml", ".yml", ".json"]
          Dir.glob(File.join(dir, "*"))
            .any? { |f| File.file?(f) && config_exts.include?(File.extname(f).downcase) }
        end
        def scan_all_magic_hints
          hints = []
          max_chars = fetch_max_hint_chars
          Dir.glob(File.join(@path, "**", "*.{py,rb,sh,md,txt}")) do |file|
            next if file.include?("/.git/") || file.include?("/.aura/") || file.include?("/state/")
            next if File.size(file) > 102400 # Skip files larger than 100KB
            rel_path = file.sub(/^#{Regexp.escape(@path)}\//, "")
            if ignored?(rel_path)
              next
            end
            begin
              File.open(file, "r") do |f|
                15.times do
                  line = f.gets
                  break unless line
                  if line =~ /@aura-hint:\s*(.*)/
                    hint_content = $1.strip
                    if hint_content.length > max_chars
                      warn "[WARNING] Aura-hint in #{rel_path} was truncated because it exceeds the #{max_chars} character limit!"
                      hint_content = hint_content[0, max_chars] + " ... [truncated: hint exceeds #{max_chars} character limit]"
                    end
                    hints << "- [From #{rel_path}]: #{hint_content}"
                  end
                end
              end
            rescue StandardError
              next
            end
          end
          hints.join("\n")
        end

        def build_knowledge_index
          kp = File.join(@path, "knowledge")
          return nil unless Dir.exist?(kp)
          Dir.glob(File.join(kp, "**", "*")).map do |f|
            next if File.directory?(f) || f.end_with?(".hint")
            rel = f.sub(/^#{Regexp.escape(kp)}\//, "")
            hint_path = f + ".hint"
            rel_hint_path = hint_path.sub(/^#{Regexp.escape(@path)}\//, "")
            hint = ""
            if File.exist?(hint_path) && !ignored?(rel_hint_path)
              hint_content = File.read(hint_path).strip
              max_file_chars = fetch_max_file_chars
              if hint_content.length > max_file_chars
                hint_content = hint_content[0, max_file_chars] + " ... [truncated]"
              end
              hint = " (Context: #{hint_content})"
            end
            "- #{rel}#{hint}"
          end.compact.join("\n")
        end

        def build_skills_knowledge
          available_tools = collect_available_tool_names

          file = File.join(@skills_path, "skills.md")
          content = ""
          if File.exist?(file)
             c = File.read(file).strip
             content += c unless c.empty?
          end

          # Scan for individual SKILL.md files
          Dir.glob(File.join(@skills_path, "*", "SKILL.md")).each do |skill_file|
            begin
              raw = File.read(skill_file)
              # Simple frontmatter parser
              if raw =~ /\A---\s+(.+?)\s+---/m
                frontmatter = $1
                meta = begin
                  YAML.safe_load(frontmatter, permitted_classes: [], permitted_symbols: [], aliases: true) || {}
                rescue StandardError
                  begin
                    YAML.load(frontmatter) || {}
                  rescue StandardError
                    {}
                  end
                end

                name = meta["name"]&.to_s&.strip
                desc = meta["description"]&.to_s&.strip
                requires = meta["requires"].is_a?(Array) ? meta["requires"].map { |x| x.to_s.strip }.reject(&:empty?) : []

                # Parse requirements from body (Anthropic style)
                if raw =~ /^##\s+(?:Requirements|Dependencies)\s*\n(.*?)(?=\n##|\Z)/m
                  body_deps = $1.scan(/-\s+`?(\w+)`?/).flatten
                  requires.concat(body_deps)
                end
                requires.uniq!

                if name && !name.empty?
                  missing = requires.reject { |t| available_tools.include?(t) }

                  content += "\n\n### Skill: #{name}"
                  content += "\nDescription: #{desc}" if desc && !desc.empty?
                  content += "\nRequires: #{requires.join(', ')}" if requires.any?
                  content += "\nMissing Requires: #{missing.join(', ')}" if missing.any?
                  rel_path = skill_file.sub(/^#{Regexp.escape(@path)}\//, "")
                  content += "\nPath: #{rel_path}"

                  # Scan for optional subdirectories (scripts, references, assets)
                  skill_dir = File.dirname(skill_file)
                  scripts_dir = File.join(skill_dir, "scripts")
                  refs_dir = File.join(skill_dir, "references")
                  assets_dir = File.join(skill_dir, "assets")

                  if Dir.exist?(scripts_dir)
                    scripts = Dir.glob(File.join(scripts_dir, "*")).map { |f| File.basename(f) }.join(", ")
                    content += "\nScripts: #{scripts}" unless scripts.empty?
                  end
                  if Dir.exist?(refs_dir)
                    refs = Dir.glob(File.join(refs_dir, "*")).map { |f| File.basename(f) }.join(", ")
                    content += "\nReferences: #{refs}" unless refs.empty?
                  end
                  if Dir.exist?(assets_dir)
                    assets = Dir.glob(File.join(assets_dir, "*")).map { |f| File.basename(f) }.join(", ")
                    content += "\nAssets: #{assets}" unless assets.empty?
                  end
                end
              end
            rescue
              next
            end
          end
          
          return nil if content.empty?
          content
        end

        def collect_available_tool_names
          tp = File.join(@env_path, "tools")
          return [] unless Dir.exist?(tp)

          names = []
          Dir.glob(File.join(tp, "*")).each do |tool_dir|
            next unless File.directory?(tool_dir)

            dir_name = File.basename(tool_dir).to_s
            names << dir_name unless dir_name.empty?

            manifest_path = File.join(tool_dir, "manifest.json")
            next unless File.exist?(manifest_path)

            begin
              man = JSON.parse(File.read(manifest_path))
              man_name = man["name"].to_s.strip
              names << man_name unless man_name.empty?
            rescue StandardError
              next
            end
          end

          names.compact.uniq
        end

        def build_user_task_view
          plan_text = nil
          db_path = begin
            cfg = File.join(@env_path, "config", "config.yml")
            if File.exist?(cfg)
              require "yaml"
              data = YAML.load_file(cfg) || {}
              p = data.dig("state_management", "db_path")
              if p && !p.to_s.empty?
                File.expand_path(p, @env_path)
              else
                File.join(@env_path, "state", "aura.db")
              end
            else
              File.join(@env_path, "state", "aura.db")
            end
          rescue StandardError
            File.join(@env_path, "state", "aura.db")
          end
          if defined?(SQLite3) && File.exist?(db_path)
            begin
              db = SQLite3::Database.new(db_path)
              plan_text = db.get_first_value("SELECT value FROM variables WHERE key = 'plan' LIMIT 1")
            rescue StandardError
            ensure
              begin; db&.close; rescue StandardError; end
            end
          end

          anchors_dir = File.join(@path, "anchors")
          nodes = []
          if Dir.exist?(anchors_dir)
            Dir.glob(File.join(anchors_dir, "*")) do |f|
              next unless File.file?(f)
              ext = File.extname(f).downcase
              begin
                data = nil
                if ext == ".json"
                  data = JSON.parse(File.read(f))
                elsif ext == ".yaml" || ext == ".yml"
                  data = YAML.load_file(f)
                else
                  next
                end
                id = data["id"] || File.basename(f, ext)
                call_when = data["call_when"]
                brief = call_when.is_a?(Array) ? call_when.first.to_s.strip : call_when.to_s.strip
                label = brief.empty? ? "" : "：#{brief}"
                nodes << "- #{id}#{label}"
              rescue StandardError
                next
              end
            end
          end

          lines = []
          lines << "### 总体任务\n#{plan_text}" if plan_text && !plan_text.to_s.empty?
          lines << "### 任务节点\n#{nodes.join("\n")}" if nodes.any?
          return nil if lines.empty?
          lines.join("\n\n")
        end

        def load_config
          cfg_file = File.join(@env_path, "config", "config.yml")
          return {} unless File.exist?(cfg_file)
          begin
            require "yaml"
            YAML.load_file(cfg_file) || {}
          rescue StandardError
            {}
          end
        end

        def fetch_max_hint_chars
          cfg = load_config
          limit = cfg.dig("hints", "max_hint_chars")
          limit ? limit.to_i : 1000
        end

        def fetch_max_file_chars
          cfg = load_config
          limit = cfg.dig("hints", "max_file_chars")
          limit ? limit.to_i : 10000
        end

        def ignored?(rel_path)
          cfg = load_config
          ignore_list = cfg.dig("hints", "ignore_list") || []
          ignore_list.any? do |pattern|
            File.fnmatch?(pattern, rel_path, File::FNM_PATHNAME | File::FNM_DOTMATCH) || 
              rel_path == pattern || 
              rel_path.include?(pattern)
          end
        end
    end
  end
end
