export const MIN_WORKFLOW_TIMEOUT_SECONDS = 1;
export const MAX_WORKFLOW_TIMEOUT_SECONDS = 86400;
export const WORKFLOW_TIMEOUT_RANGE_MESSAGE = "\u8d85\u65f6\u65f6\u95f4\u5fc5\u987b\u5728 1 \u5230 86400 \u79d2\u4e4b\u95f4\u3002";

export function isWorkflowTimeoutSecondsInRange(timeoutSeconds: number): boolean {
  return timeoutSeconds >= MIN_WORKFLOW_TIMEOUT_SECONDS && timeoutSeconds <= MAX_WORKFLOW_TIMEOUT_SECONDS;
}

export const MIN_WORKFLOW_CONCURRENT_RUNS = 1;
export const MAX_WORKFLOW_CONCURRENT_RUNS = 64;
export const WORKFLOW_CONCURRENT_RUNS_RANGE_MESSAGE = "\u540c\u65f6\u8fd0\u884c\u4e0a\u9650\u5fc5\u987b\u5728 1 \u5230 64 \u4e4b\u95f4\u3002";

export function isWorkflowConcurrentRunsInRange(maxConcurrentRuns: number): boolean {
  return (
    Number.isInteger(maxConcurrentRuns) &&
    maxConcurrentRuns >= MIN_WORKFLOW_CONCURRENT_RUNS &&
    maxConcurrentRuns <= MAX_WORKFLOW_CONCURRENT_RUNS
  );
}