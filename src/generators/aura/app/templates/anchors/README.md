id: result_analysis.finish
call_when:
  - Completed result analysis and obtained key metrics (e.g., accuracy, recall, confidence intervals)
  - Reached clear conclusions or identified necessary fallback decisions
next_suggestions: |
  Proceed to paper writing (paper_writing), return to idea generation (idea_generation) if results are insufficient, or perform additional benchmark setup (benchmark_setup). Choose one option based on current metrics and evidence, and briefly state your rationale.
summary_prompt: |
  Summarize the phase you just completed in a structured format, including:
  1) Phase goals and methodology; 2) Key results and data; 3) Metrics and evaluation;
  4) Critical evidence and risks; 5) Rationale for selecting the next phase. Suggested length: 600–1200 words.
