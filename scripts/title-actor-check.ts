import assert from "node:assert/strict";
import { swapsStoryActor, validTitle } from "../src/lib/title-generation.server.ts";

const original = "Nacional lamenta derrota frente ao Benfica";
assert.equal(swapsStoryActor("Benfica lamenta derrota", original), true);
assert.equal(validTitle("Benfica lamenta derrota", original), null);
assert.equal(swapsStoryActor("Nacional lamenta a derrota com o Benfica", original), false);
assert.equal(swapsStoryActor("Benfica vence o Nacional", "Nacional perde com o Benfica"), false);
assert.equal(swapsStoryActor("Nacional vence o Benfica", "Benfica vence o Nacional"), true);
assert.equal(swapsStoryActor("Sánchez marca eleições e abala Espanha", "Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas"), false);

console.log("title actor checks passed");
