import assert from "node:assert/strict";
import { contextualQueries, imageIdentity, sameImage, scoreCandidate, storyEntities, wikipediaPageFits } from "../src/lib/image-relevance.ts";

const nvidia = "NVIDIA anuncia novo chip de inteligência artificial para centros de dados";
assert.deepEqual(storyEntities(nvidia).map((item) => item.toLowerCase()).includes("nvidia"), true);
assert.equal(contextualQueries(nvidia).some((query) => /inteligência artificial$/i.test(query) && !/nvidia/i.test(query)), false);
assert.equal(contextualQueries(nvidia)[0]?.toLowerCase().includes("nvidia"), true);
assert.equal(scoreCandidate(nvidia, "", "closeup of a circuit board and laptop", "https://images.example/circuit.jpg").accepted, false);
assert.equal(scoreCandidate(nvidia, "", "NVIDIA Blackwell GPU announced for data centers", "https://images.example/nvidia-blackwell.jpg").accepted, true);

const apple = "Apple apresenta o novo iPhone";
assert.equal(scoreCandidate(apple, "", "generic smartphone on a table", "https://images.example/phone.jpg").accepted, false);
assert.equal(scoreCandidate(apple, "", "Apple iPhone event product photo", "https://images.example/iphone.jpg").accepted, true);

assert.equal(contextualQueries("Inteligência artificial muda o futuro").length, 0);
assert.equal(wikipediaPageFits("NVIDIA", "Inteligência artificial"), false);
assert.equal(wikipediaPageFits("NVIDIA", "Nvidia"), true);
assert.equal(sameImage(
  "https://images.unsplash.com/photo-1?w=400&q=80",
  "https://images.unsplash.com/photo-1?w=1600&q=70",
), true);
assert.notEqual(imageIdentity("https://images.unsplash.com/photo-1"), imageIdentity("https://images.unsplash.com/photo-2"));
assert.equal(scoreCandidate("Sismo abala o sul de Portugal", "vítimas e estragos em várias localidades", "mapa político da europa", "https://images.example/map.jpg").accepted, false);

console.log("image-relevance checks passed");
