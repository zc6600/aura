# Chapter 10: Pruning — Context Control and Metabolism

Because LLM context windows are expensive and finite, a healthy garden requires regular "pruning" to keep the agent's context clean and maintain a high signal-to-noise ratio.

## Workspace Active Guidance: `# @aura-hint:`

Files up to depth 5 in the workspace are scanned for `@aura-hint:` tags in their first 2000 lines. 
- Example: `# @aura-hint: Use Outfit font and HSL brand colors for all plots.`
- This lets developers embed small, context-specific constraints directly inside files where they are needed, rather than loading a massive system prompt.

## Document Sidecars: `.hint` files

For large binary files, datasets, or PDFs inside the `knowledge/` directory, Aura loads companion `<filename>.hint` files (e.g. `knowledge/paper.pdf.hint`). These sidecars supply a summary of the file's contents so that the agent doesn't need to load the entire document until absolutely necessary.

## Memory Metabolism

As an agent runs, its history in the SQLite database grows. Left unchecked, this history would eventually overflow the context. Aura's `metabolizer.rb` runs in the background to manage memory:
- When the history length exceeds limits, the metabolizer compresses older events into a high-level narrative summary.
- The detailed database records are archived or deleted, and the summary is injected into the context.
- This maintains chronological continuity while keeping context usage low.

## Tiered Compression in `Aura::Context::Base`

When compiling the final context payload, if the total length exceeds `max_state_chars`, the context builder uses a priority-based tiered compression strategy:
1. First, it compresses the state history database events.
2. Next, it drops low-priority sections like LSP diagnostics and system environment details.
3. Finally, it trims tool descriptions.
This guarantees that critical instructions and goals are never pushed out of the context window.
