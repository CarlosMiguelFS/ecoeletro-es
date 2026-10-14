/** Aceita "29101-010", "29101010" ou "29.101-010" e devolve "29101010". Retorna null se não tiver 8 dígitos. */
export function normalizarCep(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  return digitos.length === 8 ? digitos : null;
}

/** CEPs do Espírito Santo vão de 29000-000 a 29999-999. */
export function cepEhDoES(cep) {
  const prefixo = Number(cep.slice(0, 5));
  return prefixo >= 29000 && prefixo <= 29999;
}

export function formatarCep(cep) {
  return `${cep.slice(0, 5)}-${cep.slice(5)}`;
}
