import assert from "node:assert/strict";
import { entryScriptFromHtml, isNewer } from "./newVersion.js";
assert.equal(entryScriptFromHtml('<script type="module" crossorigin src="/assets/index-BiqL4PwW.js"></script>'), "/assets/index-BiqL4PwW.js");
assert.equal(entryScriptFromHtml("<html></html>"), null);
assert.ok(isNewer("/assets/index-A.js", "/assets/index-B.js"));
assert.ok(!isNewer("/assets/index-A.js", "/assets/index-A.js"));
assert.ok(!isNewer("/assets/index-A.js", null));
console.log("newVersion tests passed");
