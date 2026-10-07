import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyRunsState } from "../src/components/runs-panel";

// The test transform uses the classic JSX runtime, so components need React in scope.
(globalThis as { React?: typeof React }).React = React;

const components = join(__dirname, "..", "src", "components");
const sources = readdirSync(components)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, text: readFileSync(join(components, name), "utf8") }));

describe("first-run experience", () => {
  it("never asks the user to connect, allow, authorize or grant anything", () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/connect telemetry/i);
      expect(text, name).not.toMatch(
        /\b(allow|authori[sz]e|grant)\b[^\n]{0,30}\b(access|collect)/i,
      );
    }
  });

  it("does not open the Getting Started dialog by itself on first load", () => {
    const workspace = readFileSync(join(components, "visualizer-workspace.tsx"), "utf8");
    // The dialog opens only from the Setup button or an explicit OpenTelemetry action.
    expect(workspace).not.toMatch(/gettingStartedDismissed\)\s*setSetupOpen\(true\)/);
    expect(workspace).not.toContain('fetch("/api/settings", { cache: "no-store" })');
  });

  it("offers direct actions instead of telemetry setup in the empty Runs state", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptyRunsState, { onChooseSource: () => {}, onDemo: () => {} }),
    );
    expect(markup).toContain("Choose a session");
    expect(markup).toContain("Explore the demo");
    expect(markup).toContain("nothing is sent anywhere");
    expect(markup).not.toMatch(/telemetry/i);
  });
});
