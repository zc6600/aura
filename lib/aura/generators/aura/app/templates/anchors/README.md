id: result_analysis.finish
call_when:
  - 完成结果分析并得到关键指标（如准确率、召回、置信区间）
  - 已形成明确结论或需要回退判断
next_suggestions: |
  建议你下一步进入论文撰写（paper_writing），若结果不足则回到想法生成（idea_generation），或补充基准测试（benchmark_setup）。请根据当前指标与证据选择其一，并简述理由。
summary_prompt: |
  请用结构化方式总结你刚刚完成的阶段，包含：
  1) 阶段目标与方法；2) 关键结果与数据；3) 指标与评估；
  4) 重要证据与风险；5) 为什么选择下一阶段；字数建议 600–1200。
