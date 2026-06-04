import picocolors from 'picocolors';
import { VERSION } from '../../index.js';

export class Dashboard {
  public static readonly BOX_CHARS = {
    top_left: '╭',
    top_right: '╮',
    bottom_left: '╰',
    bottom_right: '╯',
    horizontal: '─',
    vertical: '│',
    t_down: '┬',
    t_up: '┴',
    t_left: '┤',
    t_right: '├',
    cross: '┼'
  };

  public static readonly WIDTH = 80;
  public static readonly SIDEBAR_WIDTH = 30;
  public static readonly MAIN_WIDTH = Dashboard.WIDTH - Dashboard.SIDEBAR_WIDTH - 3; // 3 for borders

  private projectPath: string;
  private config: any;
  private llmConfig: any;

  constructor(projectPath: string, config: any) {
    this.projectPath = projectPath;
    this.config = config;
    this.llmConfig = config?.llm || {};
  }

  public render(): void {
    console.log('\n');
    this.printTopBorder();
    this.printContent();
    this.printBottomBorder();
    console.log('\n');
    this.printInputHint();
    console.log('\n');
  }

  private printTopBorder(): void {
    const title = ` Aura Shell v${VERSION} `;
    const line = Dashboard.BOX_CHARS.top_left +
                 (Dashboard.BOX_CHARS.horizontal * 3) +
                 title +
                 (Dashboard.BOX_CHARS.horizontal * (Dashboard.WIDTH - 3 - title.length - 2)) +
                 Dashboard.BOX_CHARS.top_right;
    console.log(line);
  }

  private printBottomBorder(): void {
    const line = Dashboard.BOX_CHARS.bottom_left +
                 (Dashboard.BOX_CHARS.horizontal * (Dashboard.WIDTH - 2)) +
                 Dashboard.BOX_CHARS.bottom_right;
    console.log(line);
  }

  private printContent(): void {
    const logoLines = [
      '       ___   __  __  ____     ___   ',
      '      /   | / / / / / __ \\   /   |  ',
      '     / /| |/ / / / / /_/ /  / /| |  ',
      '    / ___ / /_/ / / _, _/  / ___ |  ',
      '   /_/  |_\\____/ /_/ |_|  /_/  |_|  ',
      '                                    ',
      '      :: AUTONOMOUS AGENT OS ::     '
    ];

    const tips = [
      'Tips for getting started',
      'Run /help to see commands',
      'Run /clear to reset',
      Dashboard.BOX_CHARS.horizontal * (Dashboard.SIDEBAR_WIDTH - 4),
      'Recent activity',
      'No recent activity'
    ];

    const height = Math.max(logoLines.length + 4, tips.length + 2);

    for (let i = 0; i < height; i++) {
      let leftCol = '';
      if (i < logoLines.length + 2 && i >= 2) {
        const leftText = logoLines[i - 2] || '';
        const padding = Math.floor((Dashboard.MAIN_WIDTH - leftText.length) / 2);
        leftCol = (' '.repeat(padding)) + picocolors.cyan(leftText) + (' '.repeat(Dashboard.MAIN_WIDTH - padding - leftText.length));
      } else if (i === height - 2) {
        const info = `Model: ${this.llmConfig.model || 'Unknown'}`;
        leftCol = (' '.repeat(2)) + info + (' '.repeat(Dashboard.MAIN_WIDTH - info.length - 2));
      } else if (i === height - 1) {
        const pathStr = this.truncate(this.projectPath, Dashboard.MAIN_WIDTH - 4);
        leftCol = (' '.repeat(2)) + picocolors.gray(pathStr) + (' '.repeat(Dashboard.MAIN_WIDTH - pathStr.length - 2));
      } else {
        leftCol = ' '.repeat(Dashboard.MAIN_WIDTH);
      }

      let rightCol = '';
      if (i < tips.length) {
        const rightText = tips[i] || '';
        rightCol = ` ${rightText}${' '.repeat(Dashboard.SIDEBAR_WIDTH - rightText.length - 1)}`;
      } else {
        rightCol = ' '.repeat(Dashboard.SIDEBAR_WIDTH);
      }

      console.log(`${Dashboard.BOX_CHARS.vertical}${leftCol}${Dashboard.BOX_CHARS.vertical}${rightCol}${Dashboard.BOX_CHARS.vertical}`);
    }
  }

  private printInputHint(): void {
    console.log('  Try "how does context work?"');
  }

  private truncate(text: string, length: number): string {
    if (text.length > length) {
      return '...' + text.substring(text.length - (length - 3));
    }
    return text;
  }
}
