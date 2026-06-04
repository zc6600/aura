import { PromptsRegistry } from '../../llm/prompts/registry.js';

export class DirectiveProvider {
  private projectPath: string;
  private options: any;

  constructor(projectPath: string, options: any = {}) {
    this.projectPath = projectPath;
    this.options = options || {};
  }

  public provide(): string {
    const mode = this.options.directive_mode || 'standard';
    const content = PromptsRegistry.resolve(mode, this.projectPath, this.options);
    if (!content) {
      return '';
    }
    // Replace all occurrences of {{project_path}} with projectPath
    return `${content.replace(/\{\{project_path\}\}/g, this.projectPath).trim()}\n`;
  }
}
