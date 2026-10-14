import { z } from 'zod';
import { cepEhDoES, normalizarCep } from '../utils/cep.js';
import { STATUS_SUGESTAO, TIPOS_PONTO, TIPOS_SUGESTAO } from '../utils/constantes.js';

z.config(z.locales.pt());

const textoOpcional = (maximo) => z.string().trim().max(maximo).optional();

export const esquemaId = z.object({
  id: z.coerce.number().int().positive(),
});

export const esquemaListagem = z.object({
  municipio: textoOpcional(80),
  categoria: textoOpcional(60),
  tipo: z.enum(TIPOS_PONTO).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const esquemaProximos = z
  .object({
    cep: textoOpcional(12),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    raio: z.coerce.number().positive().max(100).default(12),
    limite: z.coerce.number().int().min(1).max(200).default(100),
    categoria: textoOpcional(60),
    tipo: z.enum(TIPOS_PONTO).optional(),
  })
  .refine((d) => d.cep || (d.lat !== undefined && d.lng !== undefined), {
    message: 'Informe cep ou lat e lng.',
    path: ['cep'],
  });

export const esquemaPonto = z
  .object({
    nome: z.string().trim().min(3).max(120),
    tipo: z.enum(TIPOS_PONTO),
    logradouro: z.string().trim().min(3).max(200),
    // "s/n", "sn" e "S/N" viram "S/N".
    numero: z
      .string()
      .trim()
      .max(20)
      .transform((n) => (/^s\/?n$/i.test(n) ? 'S/N' : n))
      .optional(),
    bairro: z.string().trim().min(2).max(120),
    // Opcional: muitas fontes oficiais não informam o CEP. Quando vier, precisa ser do ES.
    cep: z
      .string()
      .transform(normalizarCep)
      .refine((cep) => cep !== null && cepEhDoES(cep), 'O CEP deve ter 8 dígitos e ser do ES.')
      .optional(),
    municipio: z.string().trim().min(2).max(80),
    latitude: z.coerce.number().optional(),
    longitude: z.coerce.number().optional(),
    telefone: textoOpcional(30),
    email: z.email().optional(),
    site: z.url().optional(),
    horario: z.record(z.string(), z.string().max(40)).optional(),
    observacoes: textoOpcional(500),
    fonte_url: z.url().optional(),
    categorias: z.array(z.string().trim()).min(1, 'Informe pelo menos uma categoria.'),
    ativo: z.boolean().optional(),
    verificado_em: z.coerce.date().optional(),
  })
  .refine((d) => (d.latitude === undefined) === (d.longitude === undefined), {
    message: 'Informe latitude e longitude juntas.',
    path: ['latitude'],
  });

export const esquemaSugestao = z
  .object({
    tipo: z.enum(TIPOS_SUGESTAO),
    ponto_id: z.coerce.number().int().positive().optional(),
    mensagem: z.string().trim().min(10).max(1000),
    email_contato: z.email().optional(),
    consentimento: z.boolean().optional(),
  })
  .refine((d) => !d.email_contato || d.consentimento === true, {
    message: 'Para informar e-mail, é preciso aceitar o uso dele para contato.',
    path: ['consentimento'],
  })
  .refine((d) => d.tipo === 'novo_ponto' || d.ponto_id, {
    message: 'Informe o ponto (ponto_id) para correção ou ponto fechado.',
    path: ['ponto_id'],
  });

export const esquemaFiltroSugestoes = z.object({
  status: z.enum(STATUS_SUGESTAO).optional(),
});

export const esquemaStatusSugestao = z.object({
  status: z.enum(['aprovada', 'rejeitada']),
});

export const esquemaLogin = z.object({
  email: z.email(),
  senha: z.string().min(1).max(200),
});
