import type { EventRecord, SQLiteStore, SummaryRecord } from './sqliteStore.js';

export interface HistoryEntry {
  ts: number;
  seq: number;
  order: number;
  id: number;
  body: string;
}

export class MemoryProvider {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  public recentEvents(
    options: {
      limit?: number | null;
      phases?: string[] | null;
      tools?: string[] | null;
    } = {},
  ): EventRecord[] {
    const fetchOpts: {
      limit?: number;
      phases?: string[];
      tools?: string[];
    } = {};
    if (typeof options.limit === 'number') fetchOpts.limit = options.limit;
    if (Array.isArray(options.phases)) fetchOpts.phases = options.phases;
    if (Array.isArray(options.tools)) fetchOpts.tools = options.tools;
    return this.store.fetchEvents(fetchOpts);
  }

  public oldEvents(keepRecent = 20): EventRecord[] {
    const total = this.store.countEvents();
    if (total <= keepRecent) {
      return [];
    }
    return this.store.fetchEvents({ offset: keepRecent });
  }

  public recentSummaries(limit?: number | null): SummaryRecord[] {
    return this.store.fetchSummaries(
      typeof limit === 'number' ? { limit } : {},
    );
  }

  public activeVariables(): Record<string, string> {
    return this.store.allVariables();
  }

  public assembleContext(
    include: Array<'events' | 'summaries' | 'variables'> = [
      'events',
      'summaries',
      'variables',
    ],
    options: {
      summary_limit?: number | null;
      event_limit?: number | null;
      phases?: string[] | null;
    } = {},
  ): Record<string, unknown> {
    const context: Record<string, unknown> = {};
    if (include.includes('events')) {
      context.events = this.recentEvents({
        limit: options.event_limit,
        phases: options.phases,
      });
    }
    if (include.includes('summaries')) {
      context.summaries = this.recentSummaries(options.summary_limit);
    }
    if (include.includes('variables')) {
      context.variables = this.activeVariables();
    }
    return context;
  }

  public toMarkdown(
    options: {
      summary_limit?: number | null;
      event_limit?: number | null;
      event_time_gap_seconds?: number;
    } = {},
  ): string {
    const section: string[] = ['# AGENT STATE & MEMORY'];
    const historyEntries: HistoryEntry[] = [];

    // 1. Process Summaries
    const summaries = this.recentSummaries(options.summary_limit);
    for (const s of summaries) {
      const content = s.content;
      if (!content?.trim()) continue;

      const ts = Number(s.timestamp || 0);
      const seq = Number(s.source_event_id || s.id || 0);
      const body = content.replace(/\s+/g, ' ').trim();
      historyEntries.push({
        ts,
        seq,
        order: 2,
        id: Number(s.id),
        body: `Summary: ${body}`,
      });
    }

    // 2. Process Active Variables
    const vars = this.activeVariables();
    if (Object.keys(vars).length > 0) {
      const lines = this.formatVariables(vars);
      if (lines.length > 0) {
        section.push(`### Variables:\n${lines.join('\n')}`);
      }
    }

    // 3. Process Events
    const items = this.recentEvents({
      limit: options.event_limit,
      phases: ['user', 'plan', 'execution'],
    });
    for (const e of items) {
      const entry = this.formatEvent(e);
      if (entry) {
        historyEntries.push(entry);
      }
    }

    // 4. Form and Sort Timeline
    if (historyEntries.length > 0) {
      // Sort by seq, then order, then id
      historyEntries.sort((a, b) => {
        if (a.seq !== b.seq) return a.seq - b.seq;
        if (a.order !== b.order) return a.order - b.order;
        return a.id - b.id;
      });

      const gap = options.event_time_gap_seconds ?? 60;
      const lines = this.formatHistoryEntries(historyEntries, gap);
      section.push(`### History:\n${lines.join('\n')}`);
    }

    if (section.length === 1) {
      section.push('(No history or variables recorded yet.)');
    }

    return section.join('\n');
  }

  private formatVariables(vars: Record<string, string>): string[] {
    const toolStatus: Record<string, string> = {};
    const toolErrors: Record<string, string> = {};
    const otherVars: Record<string, string> = {};

    for (const [k, v] of Object.entries(vars)) {
      const key = String(k);
      if (key.startsWith('tool:')) {
        const tool = key.substring(5);
        toolStatus[tool] = v;
      } else if (key.startsWith('tool_status:')) {
        const tool = key.substring(12);
        toolStatus[tool] = v;
      } else if (key.startsWith('tool_error:')) {
        const tool = key.substring(11);
        toolErrors[tool] = v;
      } else if (key.startsWith('tool_mtime:')) {
      } else {
        otherVars[key] = v;
      }
    }

    const lines: string[] = [];
    if (Object.keys(toolStatus).length > 0) {
      lines.push('Tool Status:');
      const sortedTools = Object.keys(toolStatus).sort();
      for (const tool of sortedTools) {
        const st = toolStatus[tool];
        const err = toolErrors[tool];
        const errText = err && String(err).trim() ? ` (error: ${err})` : '';
        lines.push(`- ${tool}: ${st}${errText}`);
      }
    }

    if (Object.keys(otherVars).length > 0) {
      lines.push('Variables:');
      const sortedKeys = Object.keys(otherVars).sort();
      for (const key of sortedKeys) {
        let val = String(otherVars[key]);
        if (val.length > 10000) {
          val = `${val.substring(0, 10000)} ... [truncated]`;
        }
        lines.push(`- ${key}: ${val}`);
      }
    }

    return lines;
  }

  private formatEvent(e: EventRecord): HistoryEntry | null {
    const ts = Number(e.timestamp || 0);
    const phase = String(e.phase || '');
    const tool = e.tool;
    const pl = e.payload || {};

    switch (phase) {
      case 'user': {
        const txt = String(
          (typeof pl === 'object' && pl !== null
            ? ((pl as Record<string, unknown>).content ??
              (pl as Record<string, unknown>).text ??
              '')
            : pl) || '',
        )
          .replace(/\s+/g, ' ')
          .trim();
        const seq =
          typeof pl === 'object' &&
          pl.call_seq !== undefined &&
          pl.call_seq !== null
            ? Number(pl.call_seq)
            : Number(e.id);
        return { ts, seq, order: 0, id: Number(e.id), body: `User: ${txt}` };
      }
      case 'plan': {
        const planData = typeof pl === 'object' ? pl : {};
        const planTool = (planData as { tool?: string }).tool;
        const summary = (planData as { summary?: string }).summary;
        const thought =
          (planData as { thought?: string }).thought ??
          (planData as { content?: string }).content ??
          (typeof pl === 'string' ? pl : null);

        let body = '';
        if (String(planTool) === 'final') {
          const finalContent = (planData as { args?: { content?: string } })
            .args?.content;
          let txt = String(finalContent ?? '')
            .replace(/\s+/g, ' ')
            .trim();
          if (txt.length > 200) {
            txt = `${txt.substring(0, 200)}...`;
          }
          body = `Agent: ${txt.length === 0 ? 'Task completed' : txt}`;
        } else {
          if (thought && String(thought).trim()) {
            body = `Agent: ${String(thought).replace(/\s+/g, ' ').trim()}`;
          } else if (summary && String(summary).trim()) {
            body = `Agent: ${String(summary).replace(/\s+/g, ' ').trim()}`;
          } else {
            body = `Agent: Calling ${planTool}`;
          }
        }
        return { ts, seq: Number(e.id), order: 0, id: Number(e.id), body };
      }
      case 'execution': {
        const res =
          typeof pl === 'object' ? (pl as { result?: unknown }).result : null;
        let status = '';
        if (typeof pl === 'object') {
          const resStatus =
            res && typeof res === 'object'
              ? (res as { status?: string }).status
              : null;
          const resSuccess =
            res && typeof res === 'object'
              ? (res as { success?: boolean }).success
              : null;
          const topStatus = (pl as { status?: string }).status;
          const topSuccess = (pl as { success?: boolean }).success;

          status = resStatus ?? topStatus ?? '';
          if (!status) {
            const success =
              resSuccess !== undefined && resSuccess !== null
                ? resSuccess
                : topSuccess;
            if (success === true) {
              status = 'ok';
            } else if (success === false) {
              status = 'failed';
            }
          }
        }

        let body = '';
        if (typeof pl === 'object') {
          const candidates: unknown[] = [];
          if (res && typeof res === 'object') {
            candidates.push(
              (res as { output?: string }).output,
              (res as { content?: string }).content,
              (res as { stdout?: string }).stdout,
              (res as { stderr?: string }).stderr,
              (res as { message?: string }).message,
            );
          }
          candidates.push(
            (pl as { output?: string }).output,
            (pl as { content?: string }).content,
            (pl as { stdout?: string }).stdout,
            (pl as { stderr?: string }).stderr,
            (pl as { message?: string }).message,
          );
          const found = candidates.find(
            (v) => v !== undefined && v !== null && String(v).trim(),
          );
          body =
            found !== undefined
              ? String(found)
              : res
                ? JSON.stringify(res)
                : JSON.stringify(pl);
        } else {
          body = String(pl);
        }

        body = body.replace(/\s+/g, ' ').trim();
        const seq =
          typeof pl === 'object' &&
          (pl as { call_seq?: number }).call_seq !== undefined &&
          (pl as { call_seq?: number }).call_seq !== null
            ? Number((pl as { call_seq?: number }).call_seq)
            : Number(e.id);
        return {
          ts,
          seq,
          order: 1,
          id: Number(e.id),
          body: `Tool ${tool}: ${status} - ${body}`,
        };
      }
      default:
        return null;
    }
  }

  private formatHistoryEntries(
    ordered: HistoryEntry[],
    threshold: number,
  ): string[] {
    let lastTs: number | null = null;
    const lines = ordered.map((e) => {
      const ts = e.ts;
      let prefix = '';
      if (ts > 0) {
        const timeObj = new Date(ts * 1000);
        const formatZero = (n: number) => (n < 10 ? `0${n}` : n);
        const dateStr = `${timeObj.getFullYear()}-${formatZero(timeObj.getMonth() + 1)}-${formatZero(timeObj.getDate())}`;

        let prevDateStr: string | null = null;
        if (lastTs !== null) {
          const prevTimeObj = new Date(lastTs * 1000);
          prevDateStr = `${prevTimeObj.getFullYear()}-${formatZero(prevTimeObj.getMonth() + 1)}-${formatZero(prevTimeObj.getDate())}`;
        }

        const showDate = prevDateStr !== dateStr;
        const showTime =
          showDate || lastTs === null || Math.abs(ts - lastTs) >= threshold;

        if (showTime) {
          const tstr = showDate
            ? `${dateStr} ${formatZero(timeObj.getHours())}:${formatZero(timeObj.getMinutes())}:${formatZero(timeObj.getSeconds())}`
            : `${formatZero(timeObj.getHours())}:${formatZero(timeObj.getMinutes())}:${formatZero(timeObj.getSeconds())}`;
          prefix = `[${tstr}] `;
        }
        lastTs = ts;
      }
      return `- ${prefix}${e.body}`;
    });

    const merged: string[] = [];
    let last: string | null = null;
    let count = 0;

    for (const ln of lines) {
      if (last !== null && ln === last) {
        count++;
      } else {
        if (last !== null) {
          merged.push(count > 1 ? `${last} (x${count})` : last);
        }
        last = ln;
        count = 1;
      }
    }
    if (last !== null) {
      merged.push(count > 1 ? `${last} (x${count})` : last);
    }

    return merged;
  }
}
