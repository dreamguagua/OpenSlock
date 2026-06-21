/** 用机器令牌为某 agent 换取 per-launch 的 sk_agent_*。 */

export interface AgentRuntimeConfig {
  readonly runtime?: string | null;
  readonly model?: string | null;
  readonly provider?: string | null; // default | custom
  readonly providerBaseUrl?: string | null;
  readonly providerApiKey?: string | null;
  readonly reasoning?: string | null; // default | low | medium | high
  readonly fastMode?: boolean | null;
}

export interface AgentCredential {
  readonly workspaceId: string;
  readonly agentId: string;
  readonly handle: string;
  readonly token: string;
  readonly config?: AgentRuntimeConfig;
}

export async function mintAgentToken(
  serverUrl: string,
  machineToken: string,
  handle: string,
  displayName?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentCredential> {
  const res = await fetchImpl(`${serverUrl}/daemon/agents/token`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${machineToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(displayName ? { handle, displayName } : { handle }),
  });
  const body = (await res.json().catch(() => null)) as
    | { success: boolean; data?: AgentCredential; error?: { message?: string } }
    | null;
  if (!res.ok || !body?.success || !body.data) {
    throw new Error(`换取 agent 令牌失败 (HTTP ${res.status}): ${body?.error?.message ?? ""}`);
  }
  return body.data;
}
