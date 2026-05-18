module Aura
  module LLM
    class Env
      def self.load_from(project_path)
        # 1. Load local workspace .env first (precedes global fallback)
        local_env = File.join(project_path, ".env")
        load_file(local_env) if File.exist?(local_env)

        # 2. Load global fallback ~/.aura/.env second (only sets unset keys)
        global_env = File.join(Dir.home, ".aura", ".env")
        load_file(global_env) if File.exist?(global_env)
      end

      def self.load_file(path)
        begin
          File.readlines(path).each do |line|
            line = line.strip
            next if line.empty? || line.start_with?("#")
            line = line.sub(/^export\s+/, "")
            key, val = line.split("=", 2)
            next unless key && val
            val = val.strip
            if (val.start_with?("\"") && val.end_with?("\"")) || (val.start_with?("'") && val.end_with?("'"))
              val = val[1..-2]
            end
            ENV[key] ||= val
          end
        rescue StandardError
        end
      end

      def self.resolve_api_key(provider)
        name = provider.to_s.upcase.gsub(/[^A-Z0-9]/, "_")
        vendor_key = name.empty? ? nil : "#{name}_API_KEY"
        if vendor_key && ENV[vendor_key] && !ENV[vendor_key].to_s.empty?
          ENV[vendor_key]
        else
          ENV["AURA_LLM_API_KEY"]
        end
      end
    end
  end
end
