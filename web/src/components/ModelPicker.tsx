/** Model selector: preset dropdown + "Custom…" → free text input.
 *  When an agent runs against a custom base URL the model id may differ, so Custom
 *  lets users type any model id. value = the raw model string ("" = default to daemon). */

import { useState } from "react";

const MODEL_PRESETS: ReadonlyArray<readonly [string, string]> = [
  ["", "Default (daemon)"],
  ["claude-opus-4-8", "Claude Opus 4.8"],
  ["claude-sonnet-4-6", "Claude Sonnet 4.6"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"],
  ["claude-fable-5", "Claude Fable 5"],
];

const CUSTOM = "__custom__";

export function ModelPicker(props: {
  value: string;
  onChange: (v: string) => void;
  controlClass?: string;
  testid?: string;
}) {
  const isPreset = MODEL_PRESETS.some(([v]) => v === props.value);
  const [custom, setCustom] = useState(props.value !== "" && !isPreset);

  return (
    <>
      <select
        className={props.controlClass}
        data-testid={props.testid}
        value={custom ? CUSTOM : props.value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) { setCustom(true); props.onChange(""); }
          else { setCustom(false); props.onChange(e.target.value); }
        }}
      >
        {MODEL_PRESETS.map(([v, label]) => <option key={v || "default"} value={v}>{label}</option>)}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {custom && (
        <input
          className={props.controlClass}
          data-testid={props.testid ? `${props.testid}-custom` : undefined}
          placeholder="Custom model id, e.g. gpt-5.5"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          style={{ marginTop: 8 }}
        />
      )}
    </>
  );
}
