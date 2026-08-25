# Progress Log

Tracks what's been built against the CLAUDE.md Faz 1 plan. Updated at the end of every module/work session — most recent session on top.

---

## Session log

### 2026-08-25 — Expo scaffold + queue-erp v2 design import (in progress)

**Environment**
- Scaffolded default Expo app (`create-expo-app`, TypeScript, expo-router) into `C:\Projects\erp`, git-initialized locally (no remote pushed yet — user chose local-only for now).
- Known issue: this machine runs **Node 18.16.1**; Expo/React Native 0.86 + Metro require **Node ≥20.19**. `npm install` succeeds (engine check is a warning, not a hard fail) but `npm run android` / Metro bundling has not been verified to actually run on this Node version. Needs a Node upgrade before real device/emulator testing.
- Installed `@expo-google-fonts/archivo@0.4.2` for the design's Archivo typeface.

**Design import — `B2B ERP Mobil v2.dc.html` ("Kuyruk Öncelikli ERP")**
- Source: Claude Design project `361d33fc-5167-4258-980c-b86e743546d4`, read via the `DesignSync` MCP tool (`list_files`/`get_file`), not written to.
- Concept: single work-queue instead of tabs; 9 screens (Bugün/queue, Sipariş Onayı, İş Akışı, Stok & Üretim, Para, Müşteri, Ayarlar, Netleştirme, Manuel Sipariş); dark inverted theme (`#201e1d` ground / `#f3f2f2` ink / `#ec3013` accent), Archivo type, sharp 2px-border "brutalist" component style, 5-tab bottom rail with horizontal swipe between the 5 core screens.
- **Important correction mid-session (user caught this):** initially copied the design mockup's placeholder content (customer names, order records, stock levels, etc.) as if it were real app data. Per CLAUDE.md §3/§4/§6 (Repository interface, SQLite, `Customer`/`Order`/`StockLevel`/`Employee` schemas), that content must come from the Repository layer, not be hardcoded. Corrected approach, confirmed with user: build the **design/UI now**, keep all placeholder content physically isolated in `src/features/queue-erp/mock/mockContent.ts` (flagged with a loud header comment) so it's a single, obvious deletion point once the real Repository layer exists. Business logic itself stays driven by CLAUDE.md's rules, not the design mockup's ad hoc JS.

**Built so far** (`src/features/queue-erp/`) — all done:
- `theme.ts` — color/font/spacing tokens for this screen's fixed dark palette.
- `mock/mockContent.ts` — **mock data only, delete when Repository lands.**
- `format.ts` — EUR/thousands formatting helpers (manual, not relying on `Intl` in Hermes).
- `types.ts` — `QueueAppState` shape.
- `useQueueApp.ts` — state + derived-data hook, direct port of the design's `Component` class (queue triage, order approval line editing, workflow stages, stock filtering, settings toggles, manual draft/basket, clarification templates).
- `components/`: `Stepper`, `Toast`, `Header`, `FooterCta`, `BottomRail`.
- `screens/`: all 9 done — `TodayQueueScreen`, `OrderApprovalScreen`, `WorkflowScreen`, `StockScreen`, `MoneyScreen`, `CustomerScreen`, `SettingsScreen`, `AskClarifyScreen`, `ManualDraftScreen`.
- `QueueApp.tsx` — root composition: Header + swipeable body (PanResponder, horizontal-drag threshold matching the original's 55px) + screen switch + Toast + FooterCta + BottomRail.

**Paused here at user's request** (before wiring into the running app). Not yet done:
- Wiring into the app entry (`src/app/_layout.tsx`, `src/app/index.tsx`) — replacing the default Expo demo tabs (Home/Explore) with `<QueueApp />`. Default template's `explore.tsx` / `app-tabs.tsx` will need to go since this screen owns its own bottom nav (was about to edit `_layout.tsx` when paused — `app.json` confirms `src/app` is the router root via `expo-router` plugin + default convention, no custom `root` override).
- Font loading (`expo-font` + `useFonts` from `@expo-google-fonts/archivo`) not yet wired into `_layout.tsx` — currently nothing loads the Archivo font files, so text would fall back to system font until this is done.
- No type-check / build verification run yet (`npx tsc --noEmit` not run against the new files).
- Nothing from CLAUDE.md's actual Faz 1 scope (Auth, Repository/SQLite, RBAC, other business modules) has been started — this session is purely the v2 design screen.

**Next session should start here**: wire fonts + app entry (`_layout.tsx`/`index.tsx`), remove now-dead default-tab files, run `tsc --noEmit`, then decide Node-upgrade path before attempting an actual Metro/emulator run.
