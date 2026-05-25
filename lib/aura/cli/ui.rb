# frozen_string_literal: true

module Aura
  module CLI
    module UI
      # Prompts the user with a y/N question and returns true if they answer yes.
      # Automatically falls back to default in non-interactive or test environments.
      def self.confirm?(question, default = false)
        tty_in = if File.exist?("/dev/tty") && $stdin.tty?
                   File.open("/dev/tty", "r")
                 else
                   $stdin
                 end
        tty_out = if File.exist?("/dev/tty") && $stdin.tty?
                    File.open("/dev/tty", "w")
                  else
                    $stdout
                  end

        tty_out.print "#{question} (y/N): "
        tty_out.flush

        res_gets = tty_in.gets
        return default if res_gets.nil?

        response = res_gets.strip.downcase

        tty_in.close if tty_in != $stdin
        tty_out.close if tty_out != $stdout

        %w[y yes].include?(response)
      rescue StandardError
        default
      end

      # Prompts for text input from the console
      def self.prompt(message)
        return nil unless $stdin.tty? || File.exist?("/dev/tty")

        begin
          tty_in = File.exist?("/dev/tty") ? File.open("/dev/tty", "r") : $stdin
          tty_out = File.exist?("/dev/tty") ? File.open("/dev/tty", "w") : $stdout

          tty_out.print message
          tty_out.flush
          response = tty_in.gets.to_s.strip

          tty_in.close if tty_in != $stdin
          tty_out.close if tty_out != $stdout

          response
        rescue StandardError
          nil
        end
      end
    end
  end
end
