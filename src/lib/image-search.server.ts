import { contextualQueries, distinctiveWords, namedQuery, storyEntities } from "./image-relevance";

export { contextualQueries as imageSearchTerms, namedQuery, storyEntities } from "./image-relevance";

/** Termos de pesquisa que preservam o título e as entidades específicas da notícia. */
export function extractImageTerms(title: string, description = ""): string[] {
  return distinctiveWords(`${title} ${description}`).slice(0, 8);
}

export function riskyImageTitle(title: string): boolean {
  return Boolean(namedQuery(title)) || /\b(le[aã]o|lion|tigre|tiger|águia|aguia|lobo|urso|touro)\b/i.test(title);
}

/** A primeira consulta é a entidade mais o acontecimento, nunca só o tema. */
export async function sceneQuery(title: string): Promise<string> {
  return contextualQueries(title)[0] ?? storyEntities(title)[0] ?? title.trim().replace(/\s+/g, " ").slice(0, 140);
}
