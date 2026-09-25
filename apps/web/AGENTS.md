# Web application instructions

- Preserve the established top navigation, Map/Live/Runs, canvas language, inspector, bottom timeline, playback, metrics, source/session selector, Demo mode, Live behavior, and Jump to Live.
- UI changes should be additive and minimal unless redesign is explicitly requested.
- Keep filesystem access and repository analysis in Node-only server code. Never expose arbitrary local paths or source contents through a browser-controlled request.
- Keep architecture, execution, and unified graphs distinguishable. Static edges stay subtle; runtime observations/highlights carry execution emphasis.
- Avoid moving analyzer or reconciliation logic into components or the Zustand store; consume plain package APIs.
- After UI changes, run web lint/typecheck/build and manually verify Demo, Current repository, one historical Codex session, the Show Execution toggle, and Live behavior.
