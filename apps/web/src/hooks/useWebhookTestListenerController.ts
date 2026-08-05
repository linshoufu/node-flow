import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import { formatApiError } from "../lib/apiError";
import type { WebhookTestListener } from "../types";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type WebhookTestListenerClient = Pick<
  ApiClient,
  "getWebhookTestListener" | "startWebhookTestListener" | "stopWebhookTestListener"
>;

type UseWebhookTestListenerControllerOptions = {
  client?: WebhookTestListenerClient;
  isEditorLocked: boolean;
  onMessage: (message: string) => void;
  pollIntervalMs?: number;
  workflowId: string;
};

type ListenerOperation = {
  nodeId: string;
  token: number;
  workflowId: string;
};

export function useWebhookTestListenerController({
  client = apiClient,
  isEditorLocked,
  onMessage,
  pollIntervalMs = 1_000,
  workflowId,
}: UseWebhookTestListenerControllerOptions) {
  const [listener, setListener] = useState<WebhookTestListener | null>(null);
  const [isChanging, setIsChanging] = useState(false);
  const mountedRef = useRef(true);
  const workflowIdRef = useRef(workflowId);
  const listenerRef = useRef<WebhookTestListener | null>(listener);
  const operationTokenRef = useRef(0);
  const activeOperationRef = useRef<ListenerOperation | null>(null);
  workflowIdRef.current = workflowId;
  listenerRef.current = listener;

  const updateListener = useCallback((nextListener: WebhookTestListener | null) => {
    listenerRef.current = nextListener;
    setListener(nextListener);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationTokenRef.current += 1;
      activeOperationRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    operationTokenRef.current += 1;
    activeOperationRef.current = null;
    updateListener(null);
    setIsChanging(false);
  }, [updateListener, workflowId]);

  const isOperationCurrent = useCallback((operation: ListenerOperation) =>
    mountedRef.current
    && workflowIdRef.current === operation.workflowId
    && activeOperationRef.current?.token === operation.token, []);

  const beginOperation = useCallback((nodeId: string): ListenerOperation | null => {
    const targetWorkflowId = workflowIdRef.current;
    if (
      !targetWorkflowId
      || isEditorLocked
      || activeOperationRef.current !== null
    ) {
      return null;
    }

    const operation = {
      nodeId,
      token: ++operationTokenRef.current,
      workflowId: targetWorkflowId,
    };
    activeOperationRef.current = operation;
    setIsChanging(true);
    return operation;
  }, [isEditorLocked]);

  const finishOperation = useCallback((operation: ListenerOperation) => {
    if (activeOperationRef.current?.token !== operation.token) {
      return;
    }
    activeOperationRef.current = null;
    if (mountedRef.current && workflowIdRef.current === operation.workflowId) {
      setIsChanging(false);
    }
  }, []);

  const startListening = useCallback(async (nodeId: string) => {
    const operation = beginOperation(nodeId);
    if (!operation) {
      return null;
    }

    try {
      const nextListener = await client.startWebhookTestListener(operation.workflowId, nodeId);
      if (!isOperationCurrent(operation)) {
        return null;
      }
      if (
        !nextListener.active
        || nextListener.workflow_id !== operation.workflowId
        || nextListener.node_id !== nodeId
      ) {
        updateListener(null);
        onMessage("调试 Webhook 监听未启动，请重试。");
        return null;
      }
      updateListener(nextListener);
      onMessage("正在监听调试 Webhook，等待一条请求。");
      return nextListener;
    } catch (error) {
      if (isOperationCurrent(operation)) {
        onMessage(`启动调试 Webhook 监听失败：${formatApiError(error)}`);
      }
      return null;
    } finally {
      finishOperation(operation);
    }
  }, [beginOperation, client, finishOperation, isOperationCurrent, onMessage, updateListener]);

  const stopListening = useCallback(async (nodeId: string) => {
    const operation = beginOperation(nodeId);
    if (!operation) {
      return false;
    }

    try {
      await client.stopWebhookTestListener(operation.workflowId, nodeId);
      if (!isOperationCurrent(operation)) {
        return false;
      }
      if (isSameListener(listenerRef.current, operation.workflowId, nodeId)) {
        updateListener(null);
      }
      onMessage("已停止调试 Webhook 监听。");
      return true;
    } catch (error) {
      if (isOperationCurrent(operation)) {
        onMessage(`停止调试 Webhook 监听失败：${formatApiError(error)}`);
      }
      return false;
    } finally {
      finishOperation(operation);
    }
  }, [beginOperation, client, finishOperation, isOperationCurrent, onMessage, updateListener]);

  useEffect(() => {
    if (
      !listener?.active
      || !listener.expires_at
      || listener.workflow_id !== workflowId
    ) {
      return;
    }

    const listenerSnapshot = listener;
    const expiresAt = Date.parse(listener.expires_at);
    const remainingMs = expiresAt - Date.now();
    if (!Number.isFinite(expiresAt) || remainingMs <= 0) {
      updateListener(null);
      onMessage("调试 Webhook 监听已到期。");
      return;
    }

    let pollInFlight = false;
    const expire = () => {
      if (!isSameListener(listenerRef.current, listenerSnapshot.workflow_id, listenerSnapshot.node_id)) {
        return;
      }
      updateListener(null);
      onMessage("调试 Webhook 监听已到期。");
    };
    const poll = async () => {
      if (pollInFlight) {
        return;
      }
      pollInFlight = true;
      try {
        const nextListener = await client.getWebhookTestListener(
          listenerSnapshot.workflow_id,
          listenerSnapshot.node_id,
        );
        if (
          !mountedRef.current
          || workflowIdRef.current !== listenerSnapshot.workflow_id
          || !isSameListener(
            listenerRef.current,
            listenerSnapshot.workflow_id,
            listenerSnapshot.node_id,
          )
        ) {
          return;
        }
        if (!nextListener.active) {
          updateListener(null);
          onMessage("调试 Webhook 监听已结束。");
          return;
        }
        if (
          nextListener.workflow_id === listenerSnapshot.workflow_id
          && nextListener.node_id === listenerSnapshot.node_id
        ) {
          if (!sameListenerState(listenerRef.current, nextListener)) {
            updateListener(nextListener);
          }
        }
      } catch {
        // A transient polling error must not discard an active one-shot listener.
      } finally {
        pollInFlight = false;
      }
    };

    let expirationTimer: number | null = null;
    const scheduleExpiration = () => {
      const delayMs = expiresAt - Date.now();
      if (delayMs <= 0) {
        expire();
        return;
      }
      expirationTimer = window.setTimeout(
        scheduleExpiration,
        Math.min(delayMs, MAX_TIMER_DELAY_MS),
      );
    };
    scheduleExpiration();
    const pollingTimer = window.setInterval(() => void poll(), pollIntervalMs);
    return () => {
      if (expirationTimer !== null) {
        window.clearTimeout(expirationTimer);
      }
      window.clearInterval(pollingTimer);
    };
  }, [client, listener, onMessage, pollIntervalMs, updateListener, workflowId]);

  return {
    isChanging,
    listener,
    startListening,
    stopListening,
  };
}

function isSameListener(
  listener: WebhookTestListener | null,
  workflowId: string,
  nodeId: string,
): boolean {
  return listener?.workflow_id === workflowId && listener.node_id === nodeId;
}

function sameListenerState(
  left: WebhookTestListener | null,
  right: WebhookTestListener,
): boolean {
  return left?.workflow_id === right.workflow_id
    && left.node_id === right.node_id
    && left.active === right.active
    && left.expires_at === right.expires_at;
}
