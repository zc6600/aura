# frozen_string_literal: true

module Aura
  class Error < StandardError; end

  # LLM Errors
  class LLMError < Error; end
  class LLMTimeoutError < LLMError; end
  class LLMAuthError < LLMError; end
  class LLMRateLimitError < LLMError; end
  class LLMServerError < LLMError; end
  class LLMBadRequestError < LLMError; end

  # Tool Execution Errors
  class ToolError < Error; end

  class ToolBlockedError < ToolError
    attr_reader :tool_name, :advice

    def initialize(msg, tool_name: nil, advice: nil)
      super(msg)
      @tool_name = tool_name
      @advice = advice
    end
  end

  # Loop Errors
  class LoopError < Error; end
  class TooManyFormatErrors < LoopError; end
  class TooManyToolErrors < LoopError; end
end
