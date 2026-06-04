import path from 'path';

export interface LSPDiagnosticRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface LSPDiagnosticItem {
  severity: number; // 1 = Error, 2 = Warning
  message: string;
  range: LSPDiagnosticRange;
}

export interface LSPManagerLike {
  getDiagnostics(filePath?: string): Record<string, LSPDiagnosticItem[]> | LSPDiagnosticItem[];
}

export class LSPProvider {
  private projectPath: string;
  private lspManager?: LSPManagerLike | null;

  constructor(projectPath: string, lspManager?: LSPManagerLike | null) {
    this.projectPath = path.resolve(projectPath);
    this.lspManager = lspManager;
  }

  public provide(): string {
    if (!this.lspManager) {
      return '';
    }

    let diagnostics: Record<string, LSPDiagnosticItem[]> = {};
    try {
      const res = this.lspManager.getDiagnostics();
      if (res && typeof res === 'object') {
        if (Array.isArray(res)) {
          // If it returns a list of items for the project, convert to map or format directly
          // For compatibility with the manager wrapper, we assume it returns a map from URI to array.
          diagnostics = res as unknown as Record<string, LSPDiagnosticItem[]>;
        } else {
          diagnostics = res as Record<string, LSPDiagnosticItem[]>;
        }
      }
    } catch (e) {
      return '';
    }

    if (Object.keys(diagnostics).length === 0) {
      return '';
    }

    const section: string[] = ['# CODE HEALTH (LSP Diagnostics)'];
    const errorFiles: string[] = [];

    const projectUriPrefix = `file://${this.projectPath.replace(/\\/g, '/')}`;

    for (const [uri, diags] of Object.entries(diagnostics)) {
      if (!Array.isArray(diags) || diags.length === 0) continue;

      const relPath = uri.replace(new RegExp(`^file://(localhost)?${this.projectPath.replace(/\\/g, '/')}/?`, 'i'), '');
      const errors = diags.filter(d => d.severity === 1);
      const warnings = diags.filter(d => d.severity === 2);

      if (errors.length === 0 && warnings.length === 0) continue;

      errorFiles.push(`- ${relPath}: ${errors.length} errors, ${warnings.length} warnings`);

      // Show top 3 errors for context
      const topErrors = errors.slice(0, 3);
      for (const err of topErrors) {
        const line = (err.range?.start?.line ?? 0) + 1;
        errorFiles.push(`  [L${line}] Error: ${err.message}`);
      }
    }

    if (errorFiles.length === 0) {
      return '';
    }

    section.push(errorFiles.join('\n'));
    return section.join('\n\n');
  }
}
