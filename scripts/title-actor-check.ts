import assert from "node:assert/strict";
import { swapsStoryActor, validTitle } from "../src/lib/title-generation.server.ts";
import { isPastedTitle } from "../src/lib/title-shape.ts";

const original = "Nacional lamenta derrota frente ao Benfica";
assert.equal(swapsStoryActor("Benfica lamenta derrota", original), true);
assert.equal(validTitle("Benfica lamenta derrota", original), null);
assert.equal(swapsStoryActor("Nacional lamenta a derrota com o Benfica", original), false);
assert.equal(swapsStoryActor("Benfica vence o Nacional", "Nacional perde com o Benfica"), false);
assert.equal(swapsStoryActor("Nacional vence o Benfica", "Benfica vence o Nacional"), true);
assert.equal(swapsStoryActor("Sánchez marca eleições e abala Espanha", "Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas"), false);
assert.equal(validTitle("Sánchez marca eleições e dissolve o parlamento", "Crise política em Espanha: Pedro Sánchez dissolve parlamento e anuncia eleições antecipadas"), "Sánchez marca eleições e dissolve o parlamento");

const cuts: [string, string][] = [
  ["Aprovada proposta para montar novamente tendas em Lisboa esta noite", "URGENTE: Habitação: Aprovada proposta para montar novamente tendas em Lisboa esta noite"],
  ["Mil golos valem este calvário", "Cristiano Ronaldo: mil golos valem este calvário?"],
  ["Carneiro desafia Montenegro a pôr lei das rendas na gaveta", "Habitação: Carneiro desafia Montenegro a pôr lei das rendas na gaveta"],
  ["LASK gela Alvalade após perda de bola do Sporting", "VÍDEO: LASK gela Alvalade após perda de bola do Sporting"],
];
for (const [title, source] of cuts) {
  assert.equal(isPastedTitle(title, source), true, title);
  assert.equal(validTitle(title, source), null, title);
}
assert.equal(isPastedTitle("Meta paga multa milionária ao Novo México", "Meta condenada a pagar 25 mil milhões de dólares ao Novo México por enganar utilizadores"), false);

console.log("title actor checks passed");
