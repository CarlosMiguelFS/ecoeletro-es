// Erro "previsto": a gente sabe que pode acontecer e sabe o que responder.
// O middleware de erros transforma em { erro: { codigo, mensagem } } com o status certo.
export class AppError extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}
