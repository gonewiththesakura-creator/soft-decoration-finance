import type { AIHealthResult, AIProvider, AIProviderRequest, AIProviderResponse, AIStreamEvent } from "./types";

export class MockAIProvider implements AIProvider {
  readonly requests: AIProviderRequest[] = [];
  constructor(private readonly responses: Array<AIProviderResponse | Error>) {}

  private next(request: AIProviderRequest) {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error("MockAIProvider response queue is empty");
    if (response instanceof Error) throw response;
    return response;
  }

  async generate(request: AIProviderRequest) {
    return this.next(request);
  }

  async stream(request: AIProviderRequest, onEvent?: (event: AIStreamEvent) => void) {
    onEvent?.({ type: "transport_ready", apiMode: "responses" });
    return this.next(request);
  }

  async healthCheck(): Promise<AIHealthResult> {
    return { ok: true, provider: "mock", model: "mock-model", apiMode: "responses", latencyMs: 1 };
  }
}
