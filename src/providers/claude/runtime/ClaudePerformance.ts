let traceSequence = 0;

export interface ClaudePerformanceTrace {
  mark(stage: string): void;
  measure(name: string, startStage: string, endStage: string): void;
}

export function createClaudePerformanceTrace(
  label: string,
): ClaudePerformanceTrace {
  const id = ++traceSequence;
  const prefix = `claudian:claude:${label}:${id}`;
  const marks = new Map<string, string>();
  const mark = (stage: string): void => {
    if (typeof performance === 'undefined') return;
    const name = `${prefix}:${stage}`;
    performance.mark(name);
    marks.set(stage, name);
  };
  mark('start');
  return {
    mark,
    measure(name, startStage, endStage): void {
      if (typeof performance === 'undefined') return;
      const start = marks.get(startStage);
      const end = marks.get(endStage);
      if (!start || !end) return;
      performance.measure(`${prefix}:${name}`, start, end);
    },
  };
}
