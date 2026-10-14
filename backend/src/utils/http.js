import { env } from '../config/env.js';

// GET em API dos outros, com tempo limite (ninguém merece esperar API de CEP pra sempre).
// Só dá erro se a rede cair. Um 404 volta normal, e cada serviço decide o que ele significa.
export async function buscarJson(url, { headers = {}, timeoutMs = env.timeoutExternoMs } = {}) {
  const resposta = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const corpo = await resposta.json().catch(() => null);
  return { status: resposta.status, ok: resposta.ok, corpo };
}
