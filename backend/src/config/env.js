const producao = process.env.NODE_ENV === 'production';

if (producao && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET é obrigatório em produção.');
}

function lista(valor, padrao) {
  return (valor ?? padrao)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const env = {
  producao,
  porta: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-apenas-local-nao-use-em-producao',
  jwtExpiracao: process.env.JWT_EXPIRACAO || '8h',
  corsOrigens: lista(
    process.env.CORS_ORIGINS,
    'http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000',
  ),
  nominatimUserAgent: process.env.NOMINATIM_USER_AGENT || 'EcoEletroES/1.0 (projeto academico PEI II)',
  timeoutExternoMs: Number(process.env.TIMEOUT_EXTERNO_MS) || 5000,
  cepCacheDias: Number(process.env.CEP_CACHE_DIAS) || 90,
};
