require "json"
require "open3"
require "aura/context"
require "aura/kernel/state"
require "aura/kernel/tool_validator"
require "aura/kernel/execution_engine"

module Aura
  module Kernel
    class Runner
      def initialize(project_path)
        @project_path = File.expand_path(project_path)
        @state = Aura::Kernel::State.new(@project_path)
        @validator = Aura::Kernel::ToolValidator.new(@project_path)
        @engine = Aura::Kernel::ExecutionEngine.new(@project_path)
      end

      def observe
        @state.metabolize_if_needed
        Aura::Context.assemble(@project_path, @state)
      end

      def run_call(call)
        tool = call["tool"]
        args = call["args"] || {}
        st = @validator.status_for(tool)
        unless st[:state] == "ready"
          advice = st[:reason]
          @state.record_event({ phase: "interception", tool: tool, advice: advice })
          return { status: "blocked", advice: advice }
        end
        act = @validator.ensure_active(tool)
        unless act[:ok]
          @state.record_event({ phase: "interception", tool: tool, advice: act[:advice] })
          return { status: "upgrade_required", advice: act[:advice] }
        end
        res = @engine.execute(tool, args)
        @state.record_event({ phase: "execution", tool: tool, result: res })
        res
      end
    end
  end
end
