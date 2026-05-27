# frozen_string_literal: true

require "net/http"
require "json"
require "aura/errors"

module Aura
  module LLM
    class HttpClient
      # Makes a POST request and returns the parsed JSON response or yields raw chunk lines for streaming
      def self.post(url_str, headers, body_hash, timeout: 120, stream: false, &block)
        uri = URI(url_str)
        req = Net::HTTP::Post.new(uri)
        headers.each { |k, v| req[k] = v }
        req.body = JSON.dump(body_hash)

        http_opts = {
          use_ssl: uri.scheme == "https",
          open_timeout: 10,
          read_timeout: timeout,
          write_timeout: 10
        }

        begin
          Net::HTTP.start(uri.host, uri.port, http_opts) do |http|
            if stream
              http.request(req) do |res|
                validate_response_code!(res)
                res.read_body do |chunk|
                  block.call(chunk) if block_given?
                end
              end
            else
              res = http.request(req)
              validate_response_code!(res)
              begin
                JSON.parse(res.body)
              rescue JSON::ParserError => e
                raise Aura::LLMError, "Failed to parse JSON response: #{e.message}"
              end
            end
          end
        rescue Net::OpenTimeout, Net::ReadTimeout => e
          raise Aura::LLMTimeoutError, "LLM request timed out: #{e.message}"
        rescue Aura::LLMError => e
          raise e
        rescue StandardError => e
          raise Aura::LLMError, "LLM connection failed: #{e.message}"
        end
      end

      def self.validate_response_code!(response)
        code = response.respond_to?(:code) ? response.code.to_i : 200
        return if code >= 200 && code < 300

        error_message = if response.respond_to?(:body) && response.body && !response.body.to_s.strip.empty?
                          response.body.to_s.strip
                        elsif response.respond_to?(:read_body)
                          begin
                            response.read_body.to_s.strip
                          rescue StandardError
                            ""
                          end
                        else
                          ""
                        end

        if error_message.empty?
          error_message = "HTTP Status #{code}"
        else
          begin
            parsed = JSON.parse(error_message)
            error_message = parsed.dig("error", "message") || parsed["message"] || error_message
          rescue StandardError
          end
        end

        case code
        when 401, 403
          raise Aura::LLMAuthError, "Authentication failed: #{error_message}"
        when 400
          raise Aura::LLMBadRequestError, "Bad request: #{error_message}"
        when 408, 504
          raise Aura::LLMTimeoutError, "Request timed out: #{error_message}"
        when 429
          raise Aura::LLMRateLimitError, "Rate limit exceeded: #{error_message}"
        when 500..599
          raise Aura::LLMServerError, "Server error (#{code}): #{error_message}"
        else
          raise Aura::LLMError, "LLM API Error (#{code}): #{error_message}"
        end
      end
    end
  end
end
