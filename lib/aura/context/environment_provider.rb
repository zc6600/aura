# frozen_string_literal: true

require "time"
require "json"
begin
  require "sqlite3"
rescue LoadError
end
require "yaml"
require "aura/config_loader"

module Aura
  module Context
    class EnvironmentProvider
      def initialize(path, options = {})
        @path = path
        @env_path = options[:env_path] || Aura::PathResolver.environment_path(path)
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
              content = content[0, max_file_chars] + " ... [truncated: exceeds #{max_file_chars} character limit]" if content.length > max_file_chars
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
            content = content[0, max_file_chars] + " ... [truncated: exceeds #{max_file_chars} character limit]" if content.length > max_file_chars
            rules << "### Global User Preferences & Operational Rules:\n#{content}"
          end
        end

        rules.empty? ? nil : rules.join("\n\n")
      rescue Errno::ENOENT, Errno::EACCES, IOError
        nil
      end

      def build_workspace_overview
        items = Dir.glob(File.join(@path, "*")).map do |f|
          next if File.basename(f).start_with?(".")

          rel = f.sub(%r{^#{Regexp.escape(@path)}/}, "")
          type = File.directory?(f) ? "[DIR ]" : "[FILE]"
          "- #{type} #{rel}"
        end.compact
        items.any? ? items.join("\n") : nil
      end

      def build_tool_index
        tps = [
          File.join(@path, "tools"),
          File.join(@env_path, "tools")
        ].uniq

        items = []
        tps.each do |tp|
          next unless Dir.exist?(tp)

          Dir.glob(File.join(tp, "*")).each do |f|
            next unless File.directory?(f)

            rel = f.sub(%r{^#{Regexp.escape(tp)}/}, "")
            next if rel == "anchor_submit" && !anchors_has_files?

            manifest_path = File.join(f, "manifest.json")
            status = if File.exist?(manifest_path)
                       begin
                         JSON.parse(File.read(manifest_path))["name"]
                       rescue JSON::ParserError, Errno::ENOENT, Errno::EACCES
                         "invalid-manifest"
                       end
                     else
                       "incomplete"
                     end
            items << "- [Dir: #{rel}] -> Tool: #{status}"
          end
        end
        items.uniq.any? ? items.uniq.join("\n") : nil
      end

      def anchors_has_files?
        dir = File.join(@path, "anchors")
        return false unless Dir.exist?(dir)

        config_exts = [".yaml", ".yml", ".json"]
        Dir.glob(File.join(dir, "*"))
           .any? { |f| File.file?(f) && config_exts.include?(File.extname(f).downcase) }
      end

      def scan_all_magic_hints
        require "find"
        hints = []
        max_chars = fetch_max_hint_chars
        max_files_limit = 1000
        max_depth = (@path == Dir.home || @path == "/") ? 2 : 5
        file_count = 0

        begin
          Find.find(@path) do |file|
            if File.directory?(file)
              if File.expand_path(file) == File.expand_path(@path)
                next
              end

              base = File.basename(file)
              if base.start_with?(".") || %w[node_modules vendor tmp log build dist coverage state].include?(base)
                Find.prune
              end

              # Limit recursion depth
              rel_dir = file.sub(%r{^#{Regexp.escape(@path)}/?}, "")
              depth = rel_dir.empty? ? 0 : rel_dir.split("/").size
              if depth >= max_depth
                Find.prune
              end
            else
              next unless file =~ /\.(py|rb|sh|md|txt)$/
              next if File.size(file) > 102_400 # Skip files larger than 100KB

              rel_path = file.sub(%r{^#{Regexp.escape(@path)}/}, "")
              next if ignored?(rel_path)

              file_count += 1
              if file_count > max_files_limit
                warn "[WARNING] Magic hint scan reached file limit (#{max_files_limit}). Truncating scan."
                break
              end

              begin
                File.open(file, "r") do |f|
                  15.times do
                    line = f.gets
                    break unless line

                    next unless line =~ /@aura-hint:\s*(.*)/

                    hint_content = ::Regexp.last_match(1).strip
                    if hint_content.length > max_chars
                      warn "[WARNING] Aura-hint in #{rel_path} was truncated because it exceeds the #{max_chars} character limit!"
                      hint_content = hint_content[0, max_chars] + " ... [truncated: hint exceeds #{max_chars} character limit]"
                    end
                    hints << "- [From #{rel_path}]: #{hint_content}"
                  end
                end
              rescue Errno::ENOENT, Errno::EACCES, IOError
                next
              end
            end
          end
        rescue StandardError => e
          warn "[WARNING] Error scanning for magic hints: #{e.message}"
        end

        hints.join("\n")
      end

      def build_knowledge_index
        kp = File.join(@path, "knowledge")
        return nil unless Dir.exist?(kp)

        Dir.glob(File.join(kp, "**", "*")).map do |f|
          next if File.directory?(f) || f.end_with?(".hint")

          rel = f.sub(%r{^#{Regexp.escape(kp)}/}, "")
          hint_path = "#{f}.hint"
          rel_hint_path = hint_path.sub(%r{^#{Regexp.escape(@path)}/}, "")
          hint = ""
          if File.exist?(hint_path) && !ignored?(rel_hint_path)
            hint_content = File.read(hint_path).strip
            max_file_chars = fetch_max_file_chars
            hint_content = "#{hint_content[0, max_file_chars]} ... [truncated]" if hint_content.length > max_file_chars
            hint = " (Context: #{hint_content})"
          end
          "- #{rel}#{hint}"
        end.compact.join("\n")
      end

      def build_skills_knowledge
        available_tools = collect_available_tool_names

        content = ""

        # Read skills.md from both locations
        skills_md_files = [
          File.join(@path, "skills", "skills.md"),
          File.join(@skills_path, "skills.md")
        ].uniq

        skills_md_files.each do |file|
          next unless File.exist?(file)

          begin
            c = File.read(file).strip
            content += "#{c}\n\n" unless c.empty?
          rescue Errno::ENOENT, Errno::EACCES, IOError
            next
          end
        end

        # Scan for individual SKILL.md files in both locations
        skill_files = []
        [File.join(@path, "skills"), @skills_path].uniq.each do |base_dir|
          next unless Dir.exist?(base_dir)

          Dir.glob(File.join(base_dir, "*", "SKILL.md")).each do |skill_file|
            skill_files << skill_file
          end
        end

        skill_files.uniq.each do |skill_file|
          raw = File.read(skill_file)
          # Simple frontmatter parser
          if raw =~ /\A---\s+(.+?)\s+---/m
            frontmatter = ::Regexp.last_match(1)
            meta = YAML.safe_load(frontmatter, permitted_classes: [], permitted_symbols: [], aliases: true) || {}

            name = meta["name"]&.to_s&.strip
            desc = meta["description"]&.to_s&.strip
            requires = meta["requires"].is_a?(Array) ? meta["requires"].map { |x| x.to_s.strip }.reject(&:empty?) : []

            # Parse requirements from body (Anthropic style)
            if raw =~ /^##\s+(?:Requirements|Dependencies)\s*\n(.*?)(?=\n##|\Z)/m
              body_deps = ::Regexp.last_match(1).scan(/-\s+`?(\w+)`?/).flatten
              requires.concat(body_deps)
            end
            requires.uniq!

            if name && !name.empty?
              missing = requires.reject { |t| available_tools.include?(t) }

              content += "\n\n### Skill: #{name}"
              content += "\nDescription: #{desc}" if desc && !desc.empty?
              content += "\nRequires: #{requires.join(', ')}" if requires.any?
              content += "\nMissing Requires: #{missing.join(', ')}" if missing.any?
              rel_path = skill_file.sub(%r{^#{Regexp.escape(@path)}/}, "")
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
        rescue Errno::ENOENT, Errno::EACCES, IOError, Psych::SyntaxError, Psych::DisallowedClass, ArgumentError, TypeError
          next
        end

        return nil if content.strip.empty?

        content.strip
      end

      def collect_available_tool_names
        registry = Aura::Kernel::ToolRegistry.new(@env_path)
        registry.all_tools
      end

      def build_user_task_view
        plan_text = nil
        db_path = begin
          data = Aura::ConfigLoader.load(@env_path, safe: true)
          p = data.dig("state_management", "db_path")
          if p && !p.to_s.empty?
            File.expand_path(p, @env_path)
          else
            File.join(@env_path, "state", "aura.db")
          end
        rescue Aura::ConfigLoader::ConfigError, ArgumentError, TypeError
          File.join(@env_path, "state", "aura.db")
        end
        if defined?(SQLite3) && File.exist?(db_path)
          begin
            db = SQLite3::Database.new(db_path)
            plan_text = db.get_first_value("SELECT value FROM variables WHERE key = 'plan' LIMIT 1")
          rescue SQLite3::Exception, Errno::ENOENT, Errno::EACCES, IOError
          ensure
            begin
              db&.close
            rescue SQLite3::Exception, IOError
            end
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
              elsif [".yaml", ".yml"].include?(ext)
                data = YAML.load_file(f)
              else
                next
              end
              id = data["id"] || File.basename(f, ext)
              call_when = data["call_when"]
              brief = call_when.is_a?(Array) ? call_when.first.to_s.strip : call_when.to_s.strip
              label = brief.empty? ? "" : "：#{brief}"
              nodes << "- #{id}#{label}"
            rescue JSON::ParserError, Psych::SyntaxError, Errno::ENOENT, Errno::EACCES, IOError
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
        Aura::ConfigLoader.load(@env_path, safe: true)
      rescue Aura::ConfigLoader::ConfigError, ArgumentError, TypeError
        {}
      end

      def fetch_max_hint_chars
        cfg = load_config
        limit = cfg.dig("hints", "max_hint_chars")
        limit ? limit.to_i : 1000
      end

      def fetch_max_file_chars
        cfg = load_config
        limit = cfg.dig("hints", "max_file_chars")
        limit ? limit.to_i : 10_000
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
