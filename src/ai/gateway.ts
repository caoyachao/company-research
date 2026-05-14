/**
 * LLM Gateway client — calls the local llm-gateway-sdk HTTP server.
 * OpenAI-compatible API at http://localhost:8000/v1/chat/completions
 */

const GATEWAY_BASE_URL =
  process.env.LLM_GATEWAY_URL || "http://localhost:8000/v1";
const GATEWAY_TIMEOUT = parseInt(
  process.env.LLM_GATEWAY_TIMEOUT || "120",
  10
);
const GATEWAY_MODEL = process.env.LLM_GATEWAY_MODEL || "deepseek-v4-pro";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Send a chat completion request to the LLM Gateway.
 */
export interface LLMResponse {
  content: string;
  model: string;
}

export async function callLLM(
  prompt: string,
  options?: {
    systemPrompt?: string;
    timeout?: number;
    model?: string;
    strategy?: "largest" | "cheapest" | "fastest" | "auto";
    maxTokens?: number;
    signal?: AbortSignal;
  }
): Promise<LLMResponse> {
  const timeout = options?.timeout || GATEWAY_TIMEOUT;
  const model = options?.model || GATEWAY_MODEL;
  const strategy = options?.strategy || "largest";
  const maxTokens = options?.maxTokens || 2048;

  const messages: ChatMessage[] = [];
  if (options?.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout * 1000);

  // Wire external abort signal if provided
  let onExternalAbort: (() => void) | undefined;
  if (options?.signal) {
    onExternalAbort = () => controller.abort();
    options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const response = await fetch(`${GATEWAY_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        strategy,
        messages,
        temperature: 0.7,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gateway HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from LLM Gateway");
    }
    return { content, model: data.model || "unknown" };
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      // Distinguish between user abort and timeout
      if (options?.signal?.aborted) {
        throw new Error("LLM call cancelled by user");
      }
      throw new Error(`LLM Gateway timeout after ${timeout}s`);
    }
    throw error;
  } finally {
    if (onExternalAbort && options?.signal) {
      options.signal.removeEventListener("abort", onExternalAbort);
    }
  }
}

/**
 * Health check the LLM Gateway server.
 */
export async function checkGatewayHealth(): Promise<{
  ok: boolean;
  status: string;
}> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `${GATEWAY_BASE_URL.replace("/v1", "")}/health`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!response.ok) {
      return { ok: false, status: `HTTP ${response.status}` };
    }
    const data = (await response.json()) as { status: string };
    return { ok: data.status === "healthy", status: data.status };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof Error ? error.message : String(error),
    };
  }
}
