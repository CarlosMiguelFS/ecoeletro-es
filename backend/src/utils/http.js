import { env } from '../config/env.js';

/**
 * GET em uma API externa com timeout. Não lança erro por status HTTP, só por rede/timeout,
 * para cada serviço decidir o que 404, 400 etc. significam.
 */
export async function buscarJson(url, { headers = {}, timeoutMs = env.timeoutExternoMs } = {}) {
  const resposta = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const corpo = await resposta.json().catch(() => null);
  return { status: resposta.status, ok: resposta.ok, corpo };
}
