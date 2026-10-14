/** Erro esperado da aplicação: vira { erro: { codigo, mensagem } } com o status HTTP indicado. */
export class AppError extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}
