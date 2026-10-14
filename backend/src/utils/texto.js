// Faixa Unicode dos acentos que o NFD separa das letras ("é" vira "e" + "´").
const ACENTOS = new RegExp('[\\u0300-\\u036f]', 'g');

/** "Vitória " → "vitoria". Usado para comparar nomes de município sem depender de acento ou maiúscula. */
export function normalizarTexto(texto = '') {
  return texto.normalize('NFD').replace(ACENTOS, '').toLowerCase().trim();
}
