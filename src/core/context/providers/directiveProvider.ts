import * as PromptsRegistry from '../../llm/prompts/registry.js';

export class DirectiveProvider {
  private projectPath: string;
  private options: Record<string, unknown>;

  constructor(projectPath: string, options: Record<string, unknown> = {}) {
    this.projectPath = projectPath;
    this.options = options || {};
  }

  public provide(): string {
    const mode = (this.options.directive_mode as string) || 'standard';
    const content = PromptsRegistry.resolve(
      mode,
      this.projectPath,
      this.options,
    );
    if (!content) {
      return '';
    }
    // Replace all occurrences of {{project_path}} with projectPath
    return `${content.replace(/\{\{project_path\}\}/g, this.projectPath).trim()}\n`;
  }
}
