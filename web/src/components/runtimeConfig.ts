/** 共享的 agent 运行时配置类型与默认值(原 RuntimeConfigFields.tsx 的具名导出,
 *  Vue SFC 无法附带具名导出,故拆到独立模块,供组件与各表单复用)。 */

import type { AgentProvider, AgentReasoning } from "./../types.js";

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
