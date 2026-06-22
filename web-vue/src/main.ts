import { createApp } from "vue";
import "@fontsource-variable/inter"; // 自托管 Inter,无运行时外链
import "splitpanes/dist/splitpanes.css"; // 先引入,再由 styles.css 覆盖分隔条观感
import App from "./App.vue";
import "./styles.css";

createApp(App).mount("#root");
