/** splitpanes 无自带类型,声明其导出的两个 Vue 组件。 */
declare module "splitpanes" {
  import type { DefineComponent } from "vue";
  export const Splitpanes: DefineComponent<Record<string, unknown>>;
  export const Pane: DefineComponent<Record<string, unknown>>;
}
