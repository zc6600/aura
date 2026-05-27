# frozen_string_literal: true

module Aura
  module LLM
    class Env
      # Load .env from a specific project directory, then fall back to global sources.
      def self.load_from(project_path)
        # 1. Load local workspace / given path .env first
        local_env = File.join(project_path, ".env")
        load_file(local_env) if File.exist?(local_env)

        # 2. Always load global sources as fallback
        load_global
      end

      # Load from all global .env locations in priority order.
      # Called by load_from but can also be invoked standalone.
      # Priority (last writer wins due to ||=): global repo -> ~/.aura
      def self.load_global
        # Global template repository where setup.sh may have written provider keys
        global_repo_env = File.join(Dir.home, ".aura", "repo", ".env")
        load_file(global_repo_env) if File.exist?(global_repo_env)

        # ~/.aura/.env — legacy / manually written global key store
        home_aura_env = File.join(Dir.home, ".aura", ".env")
        load_file(home_aura_env) if File.exist?(home_aura_env)
      end

      def self.load_file(path)
        File.readlines(path).each do |line|
          line = line.strip
          next if line.empty? || line.start_with?("#")

          line = line.sub(/^export\s+/, "")
          key, val = line.split("=", 2)
          next unless key && val

          val = val.strip
          val = val[1..-2] if (val.start_with?("\"") && val.end_with?("\"")) || (val.start_with?("'") && val.end_with?("'"))
          ENV[key] ||= val
        end
      rescue StandardError
      end

      def self.resolve_api_key(provider)
        name = provider.to_s.upcase.gsub(/[^A-Z0-9]/, "_")
        vendor_key = name.empty? ? nil : "#{name}_API_KEY"
        if vendor_key && ENV.fetch(vendor_key, nil) && !ENV[vendor_key].to_s.empty?
          ENV.fetch(vendor_key, nil)
        else
          ENV.fetch("AURA_LLM_API_KEY", nil)
        end
      end
    end
  end
end
