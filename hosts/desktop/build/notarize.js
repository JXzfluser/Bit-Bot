"use strict";

/**
 * macOS notarization hook for electron-builder.
 * Requires APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID.
 * Without credentials: fails honestly (does not pretend notarized).
 */

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId || !appleIdPassword || !teamId) {
    const msg =
      "[notarize] skipped — set APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID (no pretend notarize)";
    console.warn(msg);
    if (process.env.BITBOT_REQUIRE_NOTARIZE === "1") {
      throw new Error(msg);
    }
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  // Lazy require so Linux/Windows pack paths do not need the module loaded.
  const { notarize } = require("@electron/notarize");
  await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword,
    teamId,
  });
  console.log("[notarize] submitted:", appName);
};
