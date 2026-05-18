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
          # Optional: print result summary? 
          # For now, we rely on the next turn's observation or specific tool output.
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
