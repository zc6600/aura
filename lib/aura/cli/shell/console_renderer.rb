# frozen_string_literal: true

module Aura
  module CLI
    module Shell
      class ConsoleRenderer
        def initialize(verbose: false)
          @verbose = verbose
          @last_streamed = false
        end

        def on_token(text)
          unless @last_streamed
            @last_streamed = true
            print "\r\e[K" # Clear waiting line
          end
          print text
          $stdout.flush
        end

        def on_stream_end
          puts "" if @last_streamed
          @last_streamed = false
        end

        def on_waiting(elapsed)
          print "\r⏳ Waiting for response... (#{format("%.1fs", elapsed)})"
          $stdout.flush
        end

        def on_clear_waiting
          print "\r\e[K"
        end

        def on_tool_start(tool, summary, args)
          puts "\n>> 🔧 Tool: #{tool}"
          puts "   🧾 Summary: #{summary}" if summary && !summary.to_s.strip.empty?
          if @verbose
            puts "   🧩 Args: #{format_args(args)}" unless args.nil? || args.empty?
          end
        end

        def on_tool_executing
          puts "   🚀 Executing..."
        end

        def on_tool_result(result)
          status = result.is_a?(Hash) ? (result["status"] || result[:status]) : nil
          status_color = case status.to_s
          when "ok", "success" then "\e[32m"  # Green
          when "failed", "blocked" then "\e[31m"  # Red
          else "\e[33m"  # Yellow
          end
          
          puts "   #{status_color}✓ Status: #{status}\e[0m"
          
          # Extract and display output
          output = nil
          if result.is_a?(Hash)
            output = result["output"] || result[:output] ||
                     result["content"] || result[:content] ||
                     result["stdout"] || result[:stdout] ||
                     result["message"] || result[:message]
          end
          
          if output && !output.to_s.strip.empty?
            output_str = output.to_s.strip
            # Truncate long outputs
            if output_str.length > 200
              output_str = output_str[0..197] + "..."
            end
            # Show first line or truncated output
            first_line = output_str.lines.first&.strip || output_str
            puts "   📄 #{first_line}" if first_line && !first_line.empty?
          end
          
          # Display modified files if present
          if result.is_a?(Hash)
            modified = result["modified_files"] || result[:modified_files]
            if modified && !modified.empty?
              puts "   📝 Modified files:"
              modified.each do |file|
                puts "      • #{file}"
              end
            end
          end
        end

        def on_thought(thought, elapsed = nil)
          if elapsed
            puts "\n>> 💬 Response (#{format_duration(elapsed)}):"
          else
            puts "\n>> 💬 Response:"
          end
          puts thought.to_s
        end

        def on_error(message)
          puts "\n>> ⚠️  Error: #{message}"
        end

        def on_warning(message)
           puts "\n>> ⚠️  #{message}"
        end

        def ask_confirmation(message)
          print "   ⚠️  #{message} [y/N] "
          answer = $stdin.gets.strip.downcase
          answer == "y"
        end

        private

        def format_duration(seconds)
          return "0s" unless seconds
          if seconds < 60
            format("%.1fs", seconds)
          else
            format("%dm %ds", seconds / 60, seconds % 60)
          end
        end

        def format_args(args)
          return "" if args.nil?
          json = JSON.generate(args)
          if json.length > 100
            json[0..97] + "..."
          else
            json
          end
        rescue
          args.to_s
        end
      end
    end
  end
end
