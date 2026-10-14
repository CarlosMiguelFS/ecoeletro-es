// faixa Unicode dos acentos que o NFD separa das letras ("é" vira "e" + "´")
const ACENTOS = new RegExp('[\\u0300-\\u036f]', 'g');

// " Vitória " → "vitoria". Pra ninguém ficar sem resultado porque esqueceu o acento.
export function normalizarTexto(texto = '') {
  return texto.normalize('NFD').replace(ACENTOS, '').toLowerCase().trim();
}
