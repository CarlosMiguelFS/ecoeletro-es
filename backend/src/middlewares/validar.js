/**
 * Valida req.query / req.params / req.body com esquemas Zod.
 * O resultado (já convertido e com valores padrão) fica em req.dados.query, req.dados.params etc.
 * Em caso de erro, o ZodError segue para o middleware de erros.
 */
export function validar(esquemas) {
  return (req, res, next) => {
    req.dados = {};
    for (const [origem, esquema] of Object.entries(esquemas)) {
      req.dados[origem] = esquema.parse(req[origem] ?? {});
    }
    next();
  };
}
