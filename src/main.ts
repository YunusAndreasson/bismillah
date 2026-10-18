import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/app.css";

// Recorded from the very first moment so the e2e suite can assert that nothing was
// blocked by the content security policy (ARCHITECTURE.md §10). Holds no document text.
document.addEventListener("securitypolicyviolation", (event) => {
  (window.__cspViolations ??= []).push(`${event.effectiveDirective} ${event.blockedURI}`);
});

const target = document.getElementById("app");
if (!target) throw new Error("index.html is missing #app");

export default mount(App, { target });
