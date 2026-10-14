import { parse } from 'csv-parse/sync';
import { ZodError } from 'zod';
import { prisma } from '../config/db.js';
import { AppError } from '../utils/erros.js';
import { esquemaPonto } from '../validacao/esquemas.js';
import { AVISO_LOCALIZACAO_APROXIMADA, atualizarPonto, criarPonto } from './pontos.service.js';

// Cada linha sem latitude/longitude custa ~1 s de geocodificação (limite do Nominatim).
const MAXIMO_LINHAS = 200;

/** Linha do CSV (tudo texto) → objeto no formato do esquemaPonto. */
function prepararLinha(linha) {
  const dados = {};
  for (const [coluna, valor] of Object.entries(linha)) {
    if (valor !== '') dados[coluna] = valor;
  }
  if (dados.categorias) dados.categorias = dados.categorias.split('|').map((c) => c.trim());
  // Excel em português salva decimais com vírgula.
  for (const coluna of ['latitude', 'longitude']) {
    if (dados[coluna]) dados[coluna] = dados[coluna].replace(',', '.');
  }
  if (dados.horario) {
    try {
      dados.horario = JSON.parse(dados.horario);
    } catch {
      throw new AppError(
        400,
        'HORARIO_INVALIDO',
        'A coluna horario deve ser um JSON, ex.: {"seg-sex":"08:00-17:00"}.',
      );
    }
  }
  if (dados.ativo !== undefined)
    dados.ativo = !['false', '0', 'nao', 'não'].includes(dados.ativo.toLowerCase());
  // Coluna opcional com a data da informação na fonte (ex.: 2024-02-26).
  if (dados.data_info && !dados.verificado_em) dados.verificado_em = dados.data_info;
  return dados;
}

function descreverErro(erro) {
  if (erro instanceof ZodError) {
    return erro.issues.map((i) => `${i.path.join('.') || 'linha'}: ${i.message}`).join('; ');
  }
  return erro.message;
}

/**
 * Excel em português salva com ";" e decimal com vírgula ("-20,329"); outros programas usam ",".
 * Aceitar os dois ao mesmo tempo quebraria a vírgula decimal, então o separador vem do cabeçalho.
 */
function detectarSeparador(conteudo) {
  const cabecalho = conteudo.toString('utf8').split(/\r?\n/, 1)[0];
  return cabecalho.includes(';') ? ';' : ',';
}

/** Cria os pontos novos e atualiza os que já existem (mesmo nome + CEP + número). */
export async function importarCsv(conteudo) {
  let linhas;
  try {
    linhas = parse(conteudo, {
      columns: (cabecalho) => cabecalho.map((coluna) => coluna.trim().toLowerCase()),
      delimiter: detectarSeparador(conteudo),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (erro) {
    throw new AppError(400, 'CSV_INVALIDO', `Não foi possível ler o CSV: ${erro.message}`);
  }
  if (linhas.length === 0) throw new AppError(400, 'CSV_VAZIO', 'O arquivo não tem linhas de dados.');
  if (linhas.length > MAXIMO_LINHAS) {
    throw new AppError(400, 'CSV_GRANDE_DEMAIS', `Envie no máximo ${MAXIMO_LINHAS} linhas por arquivo.`);
  }

  const resultado = { total_linhas: linhas.length, criados: 0, atualizados: 0, erros: [] };
  for (const [indice, linha] of linhas.entries()) {
    const numeroLinha = indice + 2; // +1 do cabeçalho, +1 porque planilhas começam em 1
    try {
      const dados = esquemaPonto.parse(prepararLinha(linha));
      const existente = await prisma.pontoColeta.findUnique({
        where: { nome_cep_numero: { nome: dados.nome, cep: dados.cep ?? '', numero: dados.numero || 'S/N' } },
      });
      if (existente) {
        // Linha sem coordenadas e endereço igual: reaproveita as já descobertas (evita chamar o Nominatim de novo).
        const mesmoEndereco = existente.logradouro === dados.logradouro && existente.bairro === dados.bairro;
        if (dados.latitude === undefined && mesmoEndereco) {
          dados.latitude = existente.latitude;
          dados.longitude = existente.longitude;
          dados.observacoes = existente.observacoes?.includes(AVISO_LOCALIZACAO_APROXIMADA)
            ? [dados.observacoes, AVISO_LOCALIZACAO_APROXIMADA].filter(Boolean).join(' ')
            : dados.observacoes;
        }
        await atualizarPonto(existente.id, dados);
        resultado.atualizados++;
      } else {
        await criarPonto(dados);
        resultado.criados++;
      }
    } catch (erro) {
      resultado.erros.push({ linha: numeroLinha, mensagem: descreverErro(erro) });
    }
  }
  return resultado;
}
