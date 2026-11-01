import { describe, expect, it } from "vitest";
import { DESIGN_KIT_ASSETS } from "@radar/artifacts-host";
import { APPROVAL_STYLE } from "../../../../api/src/artifacts/reader-opening.js";
import { getDesignKitCss } from "../../../../api/src/artifacts/design-kit.js";
import { STARTER_APP_CSS } from "./starter-files.js";

describe("artifact style tokens", () => {
  it.each([{ name: "approval", css: APPROVAL_STYLE }, { name: "starter", css: STARTER_APP_CSS }])(
    "should use published tokens for the reviewed $name CSS properties", ({ css }) => {
      const theme = DESIGN_KIT_ASSETS.map(getDesignKitCss).join("\n");
      for (const [, token] of css.matchAll(/var\((--st-[^)]+)\)/g)) expect(theme).toContain(`${token}:`);
      for (const [, selector, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (selector!.includes("h1")) continue;
        for (const declaration of declarations!.split(";")) {
          const [property, value] = declaration.split(":").map((part) => part.trim());
          if (/^(font-size|font-weight|line-height|border|border-top|border-radius|outline|outline-offset|min-height)$/.test(property!)) {
            expect(value, `${selector}: ${property}`).toMatch(/^var\(--st-/);
          }
        }
      }
    },
  );
});
