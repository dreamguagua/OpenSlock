/** 共享的 agent 运行时配置字段:Provider(Default/Custom BYOC)、Reasoning、Fast mode。
 *  Create Agent 弹窗与 Profile 编辑表单复用。 */

import type { AgentProvider, AgentReasoning } from "../types.js";

export interface RtConfig {
  provider: AgentProvider;
  providerBaseUrl: string;
  providerApiKey: string;
  reasoning: AgentReasoning;
  fastMode: boolean;
}

export const DEFAULT_RT: RtConfig = {
  provider: "default", providerBaseUrl: "", providerApiKey: "", reasoning: "default", fastMode: false,
};

export function RuntimeConfigFields(props: {
  value: RtConfig;
  onChange: (next: RtConfig) => void;
  controlClass?: string;
}) {
  const v = props.value;
  const set = (patch: Partial<RtConfig>) => props.onChange({ ...v, ...patch });
  const cc = props.controlClass;

  return (
    <>
      <label className="edit-label">PROVIDER</label>
      <select className={cc} data-testid="rt-provider" value={v.provider} onChange={(e) => set({ provider: e.target.value as AgentProvider })}>
        <option value="default">Default</option>
        <option value="custom">Custom</option>
      </select>
      <div className="rt-hint">Default leaves the runtime's provider settings untouched. Custom sets ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY for this agent.</div>
      {v.provider === "custom" && (
        <>
          <input className={cc} data-testid="rt-base-url" placeholder="ANTHROPIC_BASE_URL (e.g. https://my-proxy/api)"
            value={v.providerBaseUrl} onChange={(e) => set({ providerBaseUrl: e.target.value })} />
          <input className={cc} data-testid="rt-api-key" type="password" placeholder="ANTHROPIC_API_KEY"
            value={v.providerApiKey} onChange={(e) => set({ providerApiKey: e.target.value })} />
        </>
      )}

      <label className="edit-label">REASONING</label>
      <select className={cc} data-testid="rt-reasoning" value={v.reasoning} onChange={(e) => set({ reasoning: e.target.value as AgentReasoning })}>
        <option value="default">Default</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>

      <label className="edit-label">MODE</label>
      <label className="astask-toggle" title="Launch this runtime in its faster/minimal mode">
        <input type="checkbox" data-testid="rt-fast" checked={v.fastMode} onChange={(e) => set({ fastMode: e.target.checked })} />
        Fast mode
      </label>
    </>
  );
}
