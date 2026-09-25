import React from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "./components/ConfirmDialog";
import App from "./App.jsx";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./styles.css";
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </React.StrictMode>,
);
