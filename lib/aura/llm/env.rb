module Aura
  module LLM
    class Env
      def self.load_from(project_path)
        path = File.join(project_path, ".env")
        return unless File.exist?(path)
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
