// Porteiro: confere query, params e body com os esquemas do Zod antes de deixar entrar.
// O que passa (já convertido e com os valores padrão) fica em req.dados.query, req.dados.body...
// O que não passa vira ZodError e vai direto pro tratarErros.
export function validar(esquemas) {
  return (req, res, next) => {
    req.dados = {};
    for (const [origem, esquema] of Object.entries(esquemas)) {
      req.dados[origem] = esquema.parse(req[origem] ?? {});
    }
    next();
  };
}
