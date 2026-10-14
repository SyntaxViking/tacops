import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./rollover-guard"; // installs the global fetch() gate - side-effect only, must run before any other module fetches
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
