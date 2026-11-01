import { mount } from "svelte";
import App from "./App.svelte";
import "../styles/app.css";
import "./mobile.css";

// The phone app (mobile/PLAN.md). Its screens share the editor, tokens and fonts, and
// nothing else of the desktop's.
const target = document.getElementById("app");
if (!target) throw new Error("index.html is missing #app");

export default mount(App, { target });
