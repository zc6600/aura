# frozen_string_literal: true

require "aura/interface/bridge"
require "aura/context"
require_relative "console_renderer"

module Aura
  module CLI
    module Shell
      class Executor
        DANGEROUS_TOOLS = %w[
          write_file
          bash_command
        ].freeze

        def initialize(project_path, runner, config_loader)
          @project_path = project_path
          # Runner is passed, but Bridge creates its own runner? 
          # Actually, we should probably wrap the passed runner or create Bridge using project_path.
          # The existing runner passed to Executor might be pre-configured.
          # But Bridge.new takes project_path.
          # Let's check where Executor is initialized. Session.rb.
          # Session creates Runner and passes it.
          # We should update Executor to use Bridge wrapping the runner, or pass runner to Bridge.
          # Let's modify Bridge to accept an optional runner.
          # For now, let's just initialize Bridge with project_path and ignore the passed runner 
          # (or better, modify Bridge to take runner).
          # To be safe and clean, let's assume we can modify Bridge to take runner.
          # But since I already wrote Bridge, I'll stick to creating a new one or I can modify Bridge.
          # Let's modify Bridge in a second step if needed. 
          # But wait, the passed runner might have state.
          # Actually, `runner` passed to Executor is `Aura::Kernel::Runner.new(project_path)`.
          # So it's fine to just use the one created by Bridge or pass it.
          # Let's modify Bridge to allow injecting runner.
          
          @bridge = Aura::Interface::Bridge.new(project_path)
          @config_loader = config_loader
          @renderer = ConsoleRenderer.new(verbose: config["verbose"])
          
          setup_bridge
        end

        def process(input, auto_mode)
          @bridge.chat(input, auto_mode: auto_mode)
        end

        private

        def config
          @config_loader.call
        end
        
        def setup_bridge
          # Register UI callbacks
          @bridge.on(:on_waiting) do |start_time, streamed_check|
            start_timer(start_time, streamed_check)
          end
          
          @bridge.on(:on_clear_waiting) do
            @timer_thread&.kill
            @renderer.on_clear_waiting
          end
          
          @bridge.on(:on_token) do |token|
            @renderer.on_token(token)
          end
          
          @bridge.on(:on_stream_end) do
            @renderer.on_stream_end
          end
          
          @bridge.on(:on_tool_start) do |tool, summary, args|
            @renderer.on_tool_start(tool, summary, args)
          end
          
          @bridge.on(:on_tool_executing) do
            @renderer.on_tool_executing
          end
          
          @bridge.on(:on_tool_result) do |result|
            @renderer.on_tool_result(result)
          end
          
          @bridge.on(:on_warning) do |msg|
            @renderer.on_warning(msg)
          end
          
          @bridge.on(:on_error) do |msg|
            @renderer.on_error(msg)
          end
          
          @bridge.on(:on_thought) do |thought, elapsed|
            @renderer.on_thought(thought, elapsed)
          end
          
          @bridge.on(:ask_confirmation) do |msg|
            @renderer.ask_confirmation(msg)
          end
          
          # Register dangerous tool check
          @bridge.register_confirmation_hook(DANGEROUS_TOOLS)
        end

        def start_timer(start_time, streamed_check)
          @timer_thread = Thread.new do
            loop do
              break if streamed_check.call
              elapsed = Time.now - start_time
              @renderer.on_waiting(elapsed)
              sleep 0.5
            end
          end
        end
      end
    end
  end
end
