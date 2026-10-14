// "29101-010", "29101010", "29.101-010"... vira tudo "29101010".
// Se não tiver 8 dígitos, devolve null e a gente reclama lá na frente.
export function normalizarCep(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  return digitos.length === 8 ? digitos : null;
}

// todo CEP capixaba começa com 29. Bonito, né?
export function cepEhDoES(cep) {
  const prefixo = Number(cep.slice(0, 5));
  return prefixo >= 29000 && prefixo <= 29999;
}

export function formatarCep(cep) {
  return `${cep.slice(0, 5)}-${cep.slice(5)}`;
}
