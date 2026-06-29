import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { initThemeMeta } from "./theme.js";
import "./styles.css";

// The theme itself is set on <html> by the bootstrap in index.html; just bring
// the address-bar color into line with it before the first render.
initThemeMeta();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
