import { defiLlamaProtocolsResponseSchema, type DefiLlamaProtocol } from "./types";

const DEFILLAMA_PROTOCOLS_URL = "https://api.llama.fi/protocols";

/**
 * Fetches DefiLlama's full protocol catalog — no authentication required.
 * This is the entire extent of this Collector's job: fetch and validate
 * the shape, nothing more — the same discipline every other Collector's
 * fetch function follows (see `../github/fetch.ts`).
 */
export async function fetchDefiLlamaProtocols(): Promise<DefiLlamaProtocol[]> {
  const response = await fetch(DEFILLAMA_PROTOCOLS_URL);

  if (!response.ok) {
    throw new Error(
      `DefiLlama API request failed for "${DEFILLAMA_PROTOCOLS_URL}": ${response.status} ${response.statusText}`,
    );
  }

  const body: unknown = await response.json();
  return defiLlamaProtocolsResponseSchema.parse(body);
}
