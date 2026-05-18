module Aura
  module LLM
    module Prompts
      class Compose
        def self.messages(context, goal = nil, summary_limits = nil)
          # no system guide; keep LLM input identical to Context + Goal
          
          user_part = []
          user_part << context
          if goal && !goal.strip.empty?
            user_part << ""
            user_part << "## CURRENT USER TASK"
            user_part << goal
          end
          
          usr = user_part.compact.join("\n")
          msgs = []
          msgs << { role: "user", content: usr }
          msgs
        end
      end
    end
  end
end
