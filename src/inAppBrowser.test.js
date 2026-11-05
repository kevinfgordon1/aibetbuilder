import assert from "node:assert/strict";
import {
  detectInAppBrowser,
  inAppSignInNotice,
  currentPageUrl,
  externalBrowserHref,
  copyText,
} from "./inAppBrowser.js";

const safariIos = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const safariMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const chromeAndroid = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const chromeMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const chromeIos = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const firefox = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";
const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const samsung = "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36";

for (const ua of ["", safariIos, safariMac, chromeAndroid, chromeMac, chromeIos, firefox, edge, samsung]) {
  assert.equal(detectInAppBrowser(ua).inApp, false, ua);
}

assert.equal(detectInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.0;]").name, "Facebook");
assert.equal(detectInAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 330.0.0.0.0").name, "Instagram");
assert.equal(detectInAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 musical_ly_2023402030 BytedanceWebview/d8a21c6").name, "TikTok");
assert.equal(detectInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.45").name, "X");
assert.equal(detectInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0").name, "Line");
assert.equal(detectInAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Gmail/2024.05.05").name, "Gmail");
assert.equal(detectInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/320.0.123456789 Mobile/15E148 Safari/604.1").name, "Google app");
assert.equal(detectInAppBrowser("Mozilla/5.0 (Linux; Android 13; SM-G991B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36").name, "WebView");
assert.equal(detectInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148").name, "WebView");

assert.match(inAppSignInNotice({ inApp: true, name: "Instagram" }), /Instagram browser/);
assert.match(inAppSignInNotice({ inApp: true, name: "Instagram" }), /Safari or Chrome/);
assert.match(inAppSignInNotice({ inApp: true, name: "WebView" }), /this browser/);

{
  const loc = {
    origin: "https://www.aibetbuilder.io",
    pathname: "/",
    search: "?utm=1&auth_next=%23ev&error=access_denied&error_description=nope",
    hash: "#promo/boost.draftkings.100.abc",
  };
  const url = new URL(currentPageUrl(loc));
  assert.equal(url.origin, "https://www.aibetbuilder.io");
  assert.equal(url.searchParams.get("utm"), "1");
  assert.equal(url.searchParams.get("auth_next"), "#ev");
  assert.equal(url.searchParams.get("error"), null);
  assert.equal(url.searchParams.get("error_description"), null);
  assert.equal(url.hash, "#promo/boost.draftkings.100.abc");
  assert.equal(currentPageUrl({
    origin: "https://www.aibetbuilder.io",
    pathname: "/",
    search: "",
    hash: "#access_token=secret&refresh_token=r",
  }), "https://www.aibetbuilder.io/");
}

{
  const page = "https://www.aibetbuilder.io/?auth_next=%23ev#promo";
  const android = externalBrowserHref(page, chromeAndroid);
  assert.match(android, /^googlechrome:\/\/navigate\?url=/);
  assert.equal(decodeURIComponent(android.slice("googlechrome://navigate?url=".length)), page);
  const ios = externalBrowserHref(page, safariIos);
  assert.equal(ios, "googlechromes://www.aibetbuilder.io/?auth_next=%23ev#promo");
  assert.equal(externalBrowserHref(page, chromeMac), "");
  assert.equal(externalBrowserHref("http://localhost/", safariIos), "");
}

{
  let written = "";
  const copied = await copyText("https://www.aibetbuilder.io/#ev", {
    clipboard: { writeText: async (value) => { written = value; } },
  });
  assert.equal(copied.ok, true);
  assert.equal(written, "https://www.aibetbuilder.io/#ev");

  let selected = "";
  const doc = {
    body: {
      appendChild() {},
      removeChild() {},
    },
    createElement() {
      return {
        value: "",
        style: {},
        setAttribute() {},
        focus() {},
        select() { selected = this.value; },
      };
    },
    execCommand(cmd) {
      assert.equal(cmd, "copy");
      return selected === "https://www.aibetbuilder.io/#ev";
    },
  };
  const fallback = await copyText("https://www.aibetbuilder.io/#ev", {
    clipboard: { writeText: async () => { throw new Error("blocked"); } },
    document: doc,
  });
  assert.equal(fallback.ok, true);
  const failed = await copyText("https://www.aibetbuilder.io/#ev", {
    clipboard: { writeText: async () => { throw new Error("blocked"); } },
    document: null,
  });
  assert.equal(failed.ok, false);
  assert.equal((await copyText("", {})).ok, false);
}

console.log("inAppBrowser.test.js ok");
