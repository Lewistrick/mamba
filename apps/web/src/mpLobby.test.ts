/**
 * Regression: multiplayer GAME OVER must not show the lobby beside the shell.
 */

import { describe, expect, it } from "vitest";
import { hideLobbyForMatchOver } from "./mpLobby.ts";

describe("hideLobbyForMatchOver", () => {
  it("hides the multiplayer page element", () => {
    const page = { hidden: false } as HTMLElement;
    hideLobbyForMatchOver(page);
    expect(page.hidden).toBe(true);
  });
});
